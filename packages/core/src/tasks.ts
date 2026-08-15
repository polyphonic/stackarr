import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CommandName } from './commands';
import { insertTaskRow, readTaskRows, updateTaskRow, writeTaskRows } from './database';
import { taskStatePath } from './paths';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked';

export type StackarrTask = {
  id: string;
  commandName: CommandName;
  commandLabel: string;
  status: TaskStatus;
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
  output?: string;
  error?: string;
  reviewedAt?: string | null;
};

let migratedTaskFile = false;
let reconciledInterruptedTasks = false;
const controllerStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const taskHandoffMarkers: Partial<Record<CommandName, string>> = {
  SecurityApply: 'STACKARR_TASK_HANDOFF_STARTED',
  UpdateStackarr: 'STACKARR_UPDATE_HANDOFF_STARTED'
};
const taskHandoffGraceMs = 30 * 60 * 1000;

export function commandStartedTaskHandoff(commandName: CommandName, exitCode: number | null, output: string) {
  const marker = taskHandoffMarkers[commandName];
  return exitCode === 0 && Boolean(marker && output.includes(marker));
}

export function readTasks(): StackarrTask[] {
  migrateTaskFileToDatabase();
  const tasks = readTaskRows();
  if (tasks) {
    return reconcileControllerRestart(tasks);
  }

  return reconcileControllerRestart(readTaskFile());
}

export function interruptedTasksAfterControllerRestart(
  tasks: StackarrTask[],
  startedAt: string,
  endedAt = new Date().toISOString()
): StackarrTask[] {
  const cutoff = Date.parse(startedAt);
  const reconciliationTime = Date.parse(endedAt);
  if (!Number.isFinite(cutoff)) {
    return tasks;
  }

  return tasks.map((task) => {
    if (task.status !== 'queued' && task.status !== 'running') {
      return task;
    }

    const taskTimestamp = Date.parse(task.startedAt ?? task.queuedAt);
    if (!Number.isFinite(taskTimestamp) || taskTimestamp >= cutoff) {
      return task;
    }

    if (
      taskOutputShowsHandoff(task) &&
      Number.isFinite(reconciliationTime) &&
      reconciliationTime - taskTimestamp < taskHandoffGraceMs
    ) {
      return task;
    }

    return {
      ...task,
      status: 'failed',
      endedAt,
      exitCode: 1,
      error: 'Task was interrupted by a Stackarr controller restart.',
      reviewedAt: null
    };
  });
}

function taskOutputShowsHandoff(task: StackarrTask) {
  const marker = taskHandoffMarkers[task.commandName];
  return Boolean(marker && task.output?.includes(marker));
}

export function writeTasks(tasks: StackarrTask[]) {
  if (writeTaskRows(tasks)) {
    return;
  }

  writeTaskFile(tasks);
}

export function createQueuedTask(commandName: CommandName, commandLabel: string): StackarrTask {
  const task: StackarrTask = {
    id: crypto.randomUUID(),
    commandName,
    commandLabel,
    status: 'queued',
    queuedAt: new Date().toISOString()
  };

  migrateTaskFileToDatabase();
  if (!insertTaskRow(task)) {
    const tasks = [task, ...readTaskFile()].slice(0, 100);
    writeTaskFile(tasks);
  }

  return task;
}

export function updateTask(id: string, patch: Partial<StackarrTask>) {
  migrateTaskFileToDatabase();
  if (updateTaskRow(id, patch)) {
    return;
  }

  const tasks = readTaskFile();
  const next = tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
  writeTaskFile(next);
}

export function setTaskReviewState(ids: string[], reviewed: boolean): StackarrTask[] {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const selectedIds = new Set(uniqueIds);
  const tasks = readTasks();
  const selected = tasks.filter(
    (task) => selectedIds.has(task.id) && (task.status === 'failed' || task.status === 'blocked')
  );
  const reviewedAt = reviewed ? new Date().toISOString() : null;

  for (const task of selected) {
    updateTask(task.id, { reviewedAt });
  }

  return selected.map((task) => ({ ...task, reviewedAt }));
}

function migrateTaskFileToDatabase() {
  if (migratedTaskFile) {
    return;
  }
  migratedTaskFile = true;

  if (!fs.existsSync(taskStatePath)) {
    return;
  }

  const existing = readTaskRows();
  if (existing === undefined || existing.length > 0) {
    return;
  }

  const tasks = readTaskFile();
  if (tasks.length > 0) {
    writeTaskRows(tasks);
  }
}

function reconcileControllerRestart(tasks: StackarrTask[]): StackarrTask[] {
  if (reconciledInterruptedTasks || process.env.STACKARR_RUNTIME !== 'docker') {
    return tasks;
  }
  reconciledInterruptedTasks = true;

  const reconciled = interruptedTasksAfterControllerRestart(tasks, controllerStartedAt);
  for (let index = 0; index < tasks.length; index += 1) {
    const before = tasks[index];
    const after = reconciled[index];
    if (before && after && before !== after) {
      updateTask(before.id, after);
    }
  }

  return reconciled;
}

function readTaskFile(): StackarrTask[] {
  if (!fs.existsSync(taskStatePath)) {
    return [];
  }

  try {
    return JSON.parse(fs.readFileSync(taskStatePath, 'utf8')) as StackarrTask[];
  } catch {
    return [];
  }
}

function writeTaskFile(tasks: StackarrTask[]) {
  fs.mkdirSync(path.dirname(taskStatePath), { recursive: true });
  fs.writeFileSync(taskStatePath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
}
