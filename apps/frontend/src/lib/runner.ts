import { spawn } from 'node:child_process';
import type { CommandDefinition } from '@stackarr/core/commands';
import { dispatchNotification, type WebhookEvent } from '@stackarr/core/notifications';
import { repoRoot, stackarrBin } from '@stackarr/core/paths';
import { readTasks, type StackarrTask, writeTasks } from '@stackarr/core/tasks';

export function runQueuedTask(task: StackarrTask, command: CommandDefinition) {
  const startedAt = new Date().toISOString();
  const runningTask: StackarrTask = { ...task, status: 'running', startedAt };
  updateTask(task.id, runningTask);

  if (process.env.STACKARR_RUNTIME === 'docker' && hostOnlyCommands.has(command.name)) {
    const terminalCommand = `stackarr ${command.args.join(' ')}`;
    const sourceCheckoutCommand = `bin/stackarr ${command.args.join(' ')}`;
    const appBundleCommand = `/Applications/Stackarr.app/Contents/MacOS/stackarr ${command.args.join(' ')}`;
    const output = [
      'Host approval required.',
      `${command.label} needs macOS host access, so Docker queued the request and paused here.`,
      'Open Terminal and paste:',
      `  ${terminalCommand}`,
      `App archive fallback: ${appBundleCommand}`,
      `Source checkouts can use: ${sourceCheckoutCommand}`,
      'Enter your Mac password if the command asks.',
      'This runs the requested host-level Stackarr action outside Docker.'
    ].join('\n');
    const blockedTask: StackarrTask = {
      ...runningTask,
      status: 'blocked',
      endedAt: new Date().toISOString(),
      output
    };

    updateTask(task.id, blockedTask);
    return blockedTask;
  }

  const child = spawn(stackarrBin, command.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      STACKARR_PLEX_HOST:
        process.env.STACKARR_RUNTIME === 'docker' ? 'host.docker.internal' : process.env.STACKARR_PLEX_HOST,
      STACKARR_RUN_SOURCE: 'web'
    },
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
    const status = exitCode === 0 ? 'completed' : 'failed';
    updateTask(task.id, {
      status,
      endedAt: new Date().toISOString(),
      exitCode: exitCode ?? undefined,
      output
    });
    void dispatchNotification(command.event as WebhookEvent, {
      commandName: command.name,
      commandLabel: command.label,
      status,
      exitCode
    });
  });

  return runningTask;
}

const hostOnlyCommands = new Set([
  'StartupInstall',
  'StartupUninstall',
  'BackupInstall',
  'BackupUninstall',
  'UpdateInstall',
  'UpdateUninstall',
  'CloudflareInstall',
  'CloudflareStart',
  'CloudflareStop',
  'CloudflareStatus',
  'CloudflareRotate',
  'CloudflareDelete',
  'CloudflareUninstall',
  'PortlessApply',
  'PortlessInstall',
  'PortlessStatus',
  'PortlessUninstall'
]);

function updateTask(id: string, patch: Partial<StackarrTask>) {
  const tasks = readTasks();
  const next = tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
  writeTasks(next);
}
