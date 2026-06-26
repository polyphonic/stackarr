import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commandRegistry, createQueuedTask } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';
import { runQueuedTask } from '../../../../../lib/runner';

const supportedArchivePattern = /\.(tar\.gz|tgz|zip)$/i;

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const form = await request.formData();
  const archive = form.get('archive') ?? form.get('backup');

  if (!isUploadedFile(archive)) {
    return json({ message: 'Backup archive file is required.' }, { status: 400 });
  }

  const originalName = archive.name || 'stackarr-backup.tar.gz';
  if (!supportedArchivePattern.test(originalName)) {
    return json({ message: 'Backup archive must be .tar.gz, .tgz, or .zip.' }, { status: 400 });
  }

  const bytes = Buffer.from(await archive.arrayBuffer());
  const uploadDir = path.join(os.tmpdir(), 'stackarr-restore-uploads');
  const archivePath = path.join(uploadDir, `${randomUUID()}-${safeArchiveName(originalName)}`);
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(archivePath, bytes, { mode: 0o600 });

  const restorePostgres = formFlag(form, 'restorePostgres', true);
  const restoreNativePlex = formFlag(form, 'restoreNativePlex', false);
  const restorePlexPreferences = formFlag(form, 'restorePlexPreferences', false);
  const forceConfig = formFlag(form, 'forceConfig', true);
  const command = {
    ...commandRegistry.RestoreBackup,
    args: [
      'backup',
      'restore',
      archivePath,
      '--yes',
      '--mark-onboarding-complete',
      '--delete-archive-after-restore',
      forceConfig ? '--force-config' : '',
      restorePostgres ? '--restore-postgres' : '--skip-postgres',
      restoreNativePlex ? '--restore-native-plex' : '--skip-native-plex',
      restorePlexPreferences ? '--restore-plex-preferences' : '--skip-plex-preferences'
    ].filter(Boolean)
  };
  const task = createQueuedTask(command.name, `${command.label}: ${originalName}`);
  runQueuedTask(task, command);

  return json(
    {
      ...task,
      archive: {
        name: originalName,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      }
    },
    { status: 202 }
  );
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value === 'object' && 'arrayBuffer' in value && 'name' in value);
}

function safeArchiveName(name: string) {
  return path.basename(name).replace(/[^A-Za-z0-9._-]/g, '_');
}

function formFlag(form: FormData, key: string, fallback: boolean) {
  const value = form.get(key);
  if (value === null || value === undefined) {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(String(value));
}
