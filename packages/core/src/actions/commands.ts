import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { type CommandName, commandRegistry } from '../commands';
import { repoRoot, stackarrBin } from '../paths';
import { type DangerousConfirmation, requireDangerousConfirmation } from '../safety/dangerous';
import { createQueuedTask, readTasks, type StackarrTask, writeTasks } from '../tasks';

const execFileAsync = promisify(execFile);

export async function runStackarrCommandAction(
  input: { command: CommandName; args?: string[] } & DangerousConfirmation
) {
  const definition = commandRegistry[input.command];
  if (!definition) throw new Error(`Unknown Stackarr command: ${input.command}`);
  if (definition.disruptive) requireDangerousConfirmation(input);
  const { stdout, stderr } = await execFileAsync(stackarrBin, [...definition.args, ...(input.args ?? [])], {
    timeout: 10 * 60 * 1000
  });
  return { command: definition.name, label: definition.label, stdout, stderr };
}

export const startStackAction = () => runStackarrCommandAction({ command: 'StackStart' });
export const stopStackAction = (input: DangerousConfirmation) =>
  runStackarrCommandAction({ command: 'StackStop', ...input });
export const runUpdateAction = (input: DangerousConfirmation) =>
  runStackarrCommandAction({ command: 'Update', ...input });
export const runDoctorAction = () => runStackarrCommandAction({ command: 'DbInfo' });
export const runPermissionsAuditAction = () => runStackarrCommandAction({ command: 'PermissionsAudit' });
export const runPermissionsFixAction = (input: DangerousConfirmation) =>
  runStackarrCommandAction({ command: 'PermissionsFix', ...input });
export const runBackupAction = () => queueStackarrCommandAction({ command: 'Backup' });

export function queueStackarrCommandAction(input: { command: CommandName; args?: string[] } & DangerousConfirmation) {
  const definition = commandRegistry[input.command];
  if (!definition) throw new Error(`Unknown Stackarr command: ${input.command}`);
  if (definition.disruptive) requireDangerousConfirmation(input);

  const task = createQueuedTask(definition.name, definition.label);
  const runningTask: StackarrTask = {
    ...task,
    status: 'running',
    startedAt: new Date().toISOString()
  };
  updateTask(task.id, runningTask);

  const child = spawn(stackarrBin, [...definition.args, ...(input.args ?? [])], {
    cwd: repoRoot,
    env: { ...process.env, STACKARR_RUN_SOURCE: 'mcp' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';

  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    updateTask(task.id, { output });
  });

  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
    updateTask(task.id, { output });
  });

  child.on('error', (error) => {
    updateTask(task.id, {
      status: 'failed',
      endedAt: new Date().toISOString(),
      error: error.message,
      output
    });
  });

  child.on('close', (exitCode) => {
    updateTask(task.id, {
      status: exitCode === 0 ? 'completed' : 'failed',
      endedAt: new Date().toISOString(),
      exitCode: exitCode ?? undefined,
      output
    });
  });

  return {
    command: definition.name,
    label: definition.label,
    taskId: task.id,
    status: 'running',
    note: 'Command queued. Poll stackarr_get_tasks or the Stackarr UI task list for progress.'
  };
}

function updateTask(id: string, patch: Partial<StackarrTask>) {
  const tasks = readTasks();
  const next = tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
  writeTasks(next);
}
