import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { repoRoot, stackarrBin } from '../paths';
import { type DangerousConfirmation, requireDangerousConfirmation } from '../safety/dangerous';

const execFileAsync = promisify(execFile);

export type MigrateCurrentStackInput = {
  dryRun?: boolean;
  sourceRoot?: string;
  stopSourceContainers?: boolean;
  overwrite?: boolean;
} & DangerousConfirmation;

export async function migrateCurrentStackAction(input: MigrateCurrentStackInput = {}) {
  const dryRun = input.dryRun !== false;
  const args = buildMigrateArgs(input, dryRun);
  const plan = {
    command: 'stackarr migrate',
    args,
    notes: [
      'Migration discovers supported existing service config directories, then copies them into Stackarr config roots.',
      'Confirmed migration stops Docker source containers by default while copying so SQLite databases are not copied mid-write.',
      'Native Plex/Jellyfin installs outside Docker are host-specific and should be migrated only on a matching host.'
    ]
  };

  if (dryRun) {
    const { stdout, stderr } = await execFileAsync(stackarrBin, args, {
      cwd: repoRoot,
      timeout: 10 * 60 * 1000,
      env: { ...process.env, STACKARR_RUN_SOURCE: 'mcp-migrate-plan' }
    });

    return {
      accepted: false,
      plan,
      stdout,
      stderr,
      nextStep:
        'Review the plan, then call stackarr_migrate_current_stack with dryRun: false. The MCP client will request approval before execution.'
    };
  }

  requireDangerousConfirmation(input);
  const { stdout, stderr } = await execFileAsync(stackarrBin, args, {
    cwd: repoRoot,
    timeout: 60 * 60 * 1000,
    env: { ...process.env, STACKARR_RUN_SOURCE: 'mcp-migrate-run' }
  });

  return {
    accepted: true,
    completed: true,
    stdout,
    stderr
  };
}

function buildMigrateArgs(input: MigrateCurrentStackInput, dryRun: boolean) {
  const args = ['migrate', dryRun ? 'plan' : 'run'];

  if (input.sourceRoot) {
    args.push('--source-root', input.sourceRoot);
  }

  if (!dryRun) {
    args.push('--yes');
  }

  if (input.stopSourceContainers === false) {
    args.push('--no-stop-source');
  }

  if (input.overwrite) {
    args.push('--overwrite');
  }

  return args;
}
