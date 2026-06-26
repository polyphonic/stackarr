import { execFile } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readEnv } from '../env';
import { repoRoot, stackarrBin } from '../paths';
import { type DangerousConfirmation, requireDangerousConfirmation } from '../safety/dangerous';
import { runBackupAction } from './commands';

const execFileAsync = promisify(execFile);

function backupRoot() {
  return readEnv().BACKUP_ROOT ?? path.join(repoRoot, 'backups');
}
export const runBackupWorkflowAction = () => runBackupAction();
export async function listBackupsAction() {
  const root = backupRoot();
  if (!fsSync.existsSync(root)) return { root, backups: [] };
  const names = await fs.readdir(root);
  return { root, backups: names };
}
export async function validateBackupAction(input: { backupPath: string }) {
  const stat = await fs.stat(input.backupPath);
  const archive = path.basename(input.backupPath).toLowerCase();
  return {
    backupPath: input.backupPath,
    exists: true,
    size: stat.size,
    valid: stat.isFile() && (archive.endsWith('.tar.gz') || archive.endsWith('.tgz') || archive.endsWith('.zip'))
  };
}
export async function getBackupStatusAction() {
  return listBackupsAction();
}

export type RestoreBackupInput = {
  backupPath: string;
  dryRun?: boolean;
  forceConfig?: boolean;
  restorePostgres?: boolean;
  restoreNativePlex?: boolean;
  restorePlexPreferences?: boolean;
  markOnboardingComplete?: boolean;
} & DangerousConfirmation;

export async function restoreBackupAction(input: RestoreBackupInput) {
  const validation = await validateBackupAction({ backupPath: input.backupPath });
  const args = buildRestoreArgs(input);
  const plan = {
    command: 'stackarr backup restore',
    args,
    validation,
    notes: [
      'Restore replaces Stackarr config and state from the backup archive.',
      'Native Plex/Jellyfin installs outside the Docker stack are host-specific; restore their data only on a matching host.'
    ]
  };

  if (!validation.valid) {
    return {
      accepted: false,
      plan,
      error: 'Backup archive must be .tar.gz, .tgz, or .zip.'
    };
  }

  if (input.dryRun !== false) {
    return {
      accepted: false,
      plan,
      nextStep:
        'Call stackarr_restore_backup with dryRun: false, confirmDangerous: true, and a reason to execute the restore.'
    };
  }

  requireDangerousConfirmation(input);
  const { stdout, stderr } = await execFileAsync(stackarrBin, args, {
    cwd: repoRoot,
    timeout: 60 * 60 * 1000,
    env: { ...process.env, STACKARR_RUN_SOURCE: 'mcp-restore' }
  });

  return {
    accepted: true,
    completed: true,
    backupPath: input.backupPath,
    stdout,
    stderr
  };
}

function buildRestoreArgs(input: RestoreBackupInput) {
  const args = ['backup', 'restore', input.backupPath, '--yes'];

  if (input.forceConfig !== false) args.push('--force-config');
  if (input.restorePostgres) args.push('--restore-postgres');
  else args.push('--skip-postgres');
  if (input.restoreNativePlex) args.push('--restore-native-plex');
  else args.push('--skip-native-plex');
  if (input.restorePlexPreferences) args.push('--restore-plex-preferences');
  else args.push('--skip-plex-preferences');
  if (input.markOnboardingComplete) args.push('--mark-onboarding-complete');

  return args;
}
export async function restoreServiceDatabaseFromBackupAction(
  input: { service: string; backupPath: string } & DangerousConfirmation
) {
  requireDangerousConfirmation(input);
  return {
    accepted: false,
    service: input.service,
    backupPath: input.backupPath,
    note: 'Database restore is guarded; no files changed.'
  };
}
