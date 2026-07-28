import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readEnv } from '../env';
import { repoRoot, stackarrBin } from '../paths';
import { type DangerousConfirmation, requireDangerousConfirmation } from '../safety/dangerous';
import { readSettings, writeSettings } from '../settings';
import { runBackupAction } from './commands';

const execFileAsync = promisify(execFile);

function backupRoot() {
  return readEnv().BACKUP_ROOT ?? path.join(repoRoot, 'backups');
}

export type BackupRecoveryKeyStatus = {
  encryptionEnabled: boolean;
  keyAvailable: boolean;
  keyValid: boolean;
  exported: boolean;
  exportedAt: string;
  keyId: string;
};

function backupRecoveryKeyPath() {
  const env = readEnv();
  return (
    process.env.BACKUP_ENCRYPTION_KEY_FILE?.trim() ||
    path.join(env.STATE_ROOT ?? path.join(repoRoot, 'state'), 'backup-encryption.key')
  );
}

function recoveryKeyBytes(value: string) {
  const text = value.trim();
  const bytes = /^[a-f0-9]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  return bytes.length === 32 ? bytes : undefined;
}

function recoveryKeyId(bytes: Uint8Array) {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function readRecoveryKey() {
  const keyPath = backupRecoveryKeyPath();

  try {
    const stat = fsSync.lstatSync(keyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 32 || stat.size > 4096) {
      return { keyPath, keyAvailable: true, keyValid: false, contents: '', keyId: '' };
    }

    const contents = fsSync.readFileSync(keyPath, 'utf8');
    const bytes = recoveryKeyBytes(contents);
    return {
      keyPath,
      keyAvailable: true,
      keyValid: Boolean(bytes),
      contents,
      keyId: bytes ? recoveryKeyId(bytes) : ''
    };
  } catch {
    return { keyPath, keyAvailable: false, keyValid: false, contents: '', keyId: '' };
  }
}

export function getBackupRecoveryKeyStatusAction(): BackupRecoveryKeyStatus {
  const env = readEnv();
  const settings = readSettings();
  const recoveryKey = readRecoveryKey();
  const encryptionEnabled = String(env.BACKUP_ENCRYPTION ?? 'keyfile').toLowerCase() !== 'none';
  const exported = Boolean(
    recoveryKey.keyValid &&
      settings.backups.recoveryKeyExportedAt &&
      settings.backups.recoveryKeyExportedKeyId === recoveryKey.keyId
  );

  return {
    encryptionEnabled,
    keyAvailable: recoveryKey.keyAvailable,
    keyValid: recoveryKey.keyValid,
    exported,
    exportedAt: exported ? settings.backups.recoveryKeyExportedAt : '',
    keyId: recoveryKey.keyId
  };
}

export async function exportBackupRecoveryKeyAction() {
  const env = readEnv();
  if (String(env.BACKUP_ENCRYPTION ?? 'keyfile').toLowerCase() === 'none') {
    throw new Error('Backup encryption is disabled, so there is no recovery key to export.');
  }
  const recoveryKey = readRecoveryKey();
  if (!recoveryKey.keyAvailable) {
    throw new Error('Run an encrypted backup first so Stackarr can generate its recovery key.');
  }
  if (!recoveryKey.keyValid) {
    throw new Error('The backup recovery key is invalid and cannot be exported safely.');
  }

  await fs.chmod(recoveryKey.keyPath, 0o600);
  const exportedAt = new Date().toISOString();
  writeSettings({
    backups: {
      recoveryKeyExportedAt: exportedAt,
      recoveryKeyExportedKeyId: recoveryKey.keyId
    }
  });

  return {
    contents: recoveryKey.contents,
    exportedAt,
    keyId: recoveryKey.keyId,
    fileName: `stackarr-backup-recovery-key-${recoveryKey.keyId}.txt`
  };
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
    valid:
      stat.isFile() &&
      (archive.endsWith('.tar.gz.enc') ||
        archive.endsWith('.tgz.enc') ||
        archive.endsWith('.tar.gz') ||
        archive.endsWith('.tgz') ||
        archive.endsWith('.zip'))
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
  restoreNativeJellyfin?: boolean;
  backupKeyPath?: string;
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
      'Native Plex/Jellyfin installs outside the Docker stack are host-specific; restore their data only on a matching host.',
      'Encrypted backups require the separately stored backup key file.'
    ]
  };

  if (!validation.valid) {
    return {
      accepted: false,
      plan,
      error: 'Backup archive must be .tar.gz.enc, .tar.gz, .tgz, or .zip.'
    };
  }

  if (input.dryRun !== false) {
    return {
      accepted: false,
      plan,
      nextStep:
        'Review the plan, then call stackarr_restore_backup with dryRun: false. The MCP client will request approval before execution.'
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
  if (input.restoreNativeJellyfin) args.push('--restore-native-jellyfin');
  else args.push('--skip-native-jellyfin');
  if (input.backupKeyPath) args.push('--backup-key-file', input.backupKeyPath);
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
