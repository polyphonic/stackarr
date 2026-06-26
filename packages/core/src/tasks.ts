import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CommandName } from './commands';
import { readTaskRows, writeTaskRows } from './database';
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
};

let migratedTaskFile = false;

export function readTasks(): StackarrTask[] {
  migrateTaskFileToDatabase();
  const tasks = readTaskRows();
  if (tasks) {
    return tasks;
  }

  return readTaskFile();
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

  const tasks = [task, ...readTasks()].slice(0, 100);
  writeTasks(tasks);

  return task;
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
