import { spawn } from 'node:child_process';
import type { CommandDefinition } from '@stackarr/core/commands';
import { dispatchNotification, type WebhookEvent } from '@stackarr/core/notifications';
import { repoRoot, stackarrBin } from '@stackarr/core/paths';
import { updateTask as persistTaskUpdate, type StackarrTask } from '@stackarr/core/tasks';

type InitialSetupOptions = {
  configureSeerr?: boolean;
  installBackup?: boolean;
  installUpdates?: boolean;
};

type SetupStep = {
  label: string;
  args: string[];
  progress: number;
};

export function runQueuedTask(task: StackarrTask, command: CommandDefinition) {
  const startedAt = new Date().toISOString();
  const runningTask: StackarrTask = { ...task, status: 'running', startedAt };
  updateTask(task.id, runningTask);

  if (process.env.STACKARR_RUNTIME === 'docker' && hostOnlyCommands.has(command.name)) {
    const output = [
      'Host approval required.',
      `${command.label} needs access to the Docker host, so the container paused this task.`,
      'Open the matching Stackarr documentation from a trusted host terminal and complete the host-only step there.',
      'The container cannot request operating-system approval on your behalf.'
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
      STACKARR_RUN_SOURCE: 'web',
      STACKARR_TASK_ID: task.id
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
    if (
      command.name === 'SecurityApply' &&
      exitCode === 0 &&
      output.includes('STACKARR_TASK_HANDOFF_STARTED')
    ) {
      return;
    }
    if (command.name === 'UpdateStackarr' && exitCode === 0 && output.includes('STACKARR_UPDATE_HANDOFF_STARTED')) {
      return;
    }
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

export function runInitialSetupTask(task: StackarrTask, options: InitialSetupOptions = {}) {
  const startedAt = new Date().toISOString();
  const runningTask: StackarrTask = { ...task, status: 'running', startedAt };
  updateTask(task.id, runningTask);

  void runInitialSetupSequence(runningTask, options);

  return runningTask;
}

async function runInitialSetupSequence(task: StackarrTask, options: InitialSetupOptions) {
  let output = '';

  function append(value: string) {
    output += value;
    updateTask(task.id, { output });
  }

  function appendLine(value: string) {
    append(`${value}\n`);
  }

  try {
    const steps = buildInitialSetupSteps(options);
    appendLine('PROGRESS 2 Preparing initial setup');

    for (const step of steps) {
      appendLine(`PROGRESS ${step.progress} ${step.label}`);

      if (process.env.STACKARR_RUNTIME === 'docker' && hostOnlyCommands.has(stepNameFromArgs(step.args))) {
        append(hostApprovalMessage(step));
        continue;
      }

      await runStackarrStep(step, append);
    }

    appendLine('PROGRESS 100 Initial setup complete');
    updateTask(task.id, {
      status: 'completed',
      endedAt: new Date().toISOString(),
      exitCode: 0,
      output
    });
    void dispatchNotification('Configure' as WebhookEvent, {
      commandName: task.commandName,
      commandLabel: task.commandLabel,
      status: 'completed',
      exitCode: 0
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLine(message);
    updateTask(task.id, {
      status: 'failed',
      endedAt: new Date().toISOString(),
      error: message,
      output
    });
    void dispatchNotification('Configure' as WebhookEvent, {
      commandName: task.commandName,
      commandLabel: task.commandLabel,
      status: 'failed',
      exitCode: 1
    });
  }
}

function buildInitialSetupSteps(options: InitialSetupOptions): SetupStep[] {
  const steps: SetupStep[] = [
    {
      label: 'Downloading images if needed and starting Docker services',
      args: ['up'],
      progress: 8
    },
    {
      label: 'Configuring service connections and credentials',
      args: ['configure'],
      progress: 58
    },
    {
      label: 'Applying Plex-friendly naming defaults',
      args: ['naming', 'apply', '--wait'],
      progress: 74
    },
    {
      label: 'Applying download categories and paths',
      args: ['downloads', 'apply'],
      progress: 82
    }
  ];

  if (options.configureSeerr) {
    steps.push({
      label: 'Applying request manager defaults',
      args: ['requests', 'apply'],
      progress: 88
    });
  }

  if (options.installBackup) {
    steps.push({
      label: 'Enabling scheduled backup automation',
      args: ['backup', 'install'],
      progress: 96
    });
  }

  if (options.installUpdates) {
    steps.push({
      label: 'Enabling scheduled update automation',
      args: ['update', 'install'],
      progress: 98
    });
  }

  return steps;
}

function runStackarrStep(step: SetupStep, append: (value: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(stackarrBin, step.args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        STACKARR_PLEX_HOST:
          process.env.STACKARR_RUNTIME === 'docker' ? 'host.docker.internal' : process.env.STACKARR_PLEX_HOST,
        STACKARR_RUN_SOURCE: 'web-onboarding'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => append(chunk.toString()));
    child.stderr.on('data', (chunk) => append(chunk.toString()));
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`${step.label} failed with exit code ${exitCode ?? 'unknown'}.`));
      }
    });
  });
}

function stepNameFromArgs(args: string[]) {
  if (args[0] === 'startup') return args[1] === 'uninstall' ? 'StartupUninstall' : 'StartupInstall';
  if (args[0] === 'backup') {
    if (args[1] === 'uninstall') return 'BackupUninstall';
    if (args[1] === 'permissions') return 'BackupPermissions';
    return 'BackupInstall';
  }
  if (args[0] === 'update') return args[1] === 'uninstall' ? 'UpdateUninstall' : 'UpdateInstall';
  return '';
}

function hostApprovalMessage(step: SetupStep) {
  return (
    [
      `${step.label} needs host access and cannot be completed from the Docker container.`,
      'Open the matching Stackarr documentation and complete the host-only step from a trusted terminal.'
    ].join('\n') + '\n'
  );
}

const hostOnlyCommands = new Set([
  'CloudflareInstall',
  'CloudflareStart',
  'CloudflareStop',
  'CloudflareStatus',
  'CloudflareSync',
  'CloudflareRotate',
  'CloudflareDelete',
  'CloudflareUninstall',
  'PortlessApply',
  'PortlessInstall',
  'PortlessStatus',
  'PortlessUninstall'
]);

function updateTask(id: string, patch: Partial<StackarrTask>) {
  persistTaskUpdate(id, patch);
}
