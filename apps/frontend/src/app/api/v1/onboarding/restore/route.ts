import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commandRegistry, createQueuedTask, readEnv } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';
import { runQueuedTask } from '../../../../../lib/runner';

const supportedArchivePattern = /\.(tar\.gz|tgz|zip)$/i;
const maxRestoreArchiveBytes = 1024 * 1024 * 1024;
const restoreUploadWindowMs = 15 * 60 * 1000;
const restoreUploadMaxAttempts = 3;
const restoreUploadBuckets = new Map<string, { attempts: number; resetAt: number }>();
let activeRestoreUploads = 0;

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxRestoreArchiveBytes) {
    return json({ message: 'Backup archive is larger than the allowed restore upload size.' }, { status: 413 });
  }

  const rateLimit = claimRestoreUploadAttempt(request);
  if (rateLimit) {
    return json(
      { message: 'Too many restore upload attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    );
  }

  if (activeRestoreUploads > 0) {
    return json({ message: 'Another restore upload is already being processed.' }, { status: 409 });
  }

  activeRestoreUploads += 1;
  try {
    const form = await request.formData();
    const archive = form.get('archive') ?? form.get('backup');

    if (!formFlag(form, 'confirmRestore', false)) {
      return json({ message: 'Restore confirmation is required.' }, { status: 409 });
    }

    if (!isUploadedFile(archive)) {
      return json({ message: 'Backup archive file is required.' }, { status: 400 });
    }

    const originalName = archive.name || 'stackarr-backup.tar.gz';
    if (!supportedArchivePattern.test(originalName)) {
      return json({ message: 'Backup archive must be .tar.gz, .tgz, or .zip.' }, { status: 400 });
    }

    if (archive.size > maxRestoreArchiveBytes) {
      return json({ message: 'Backup archive is larger than the allowed restore upload size.' }, { status: 413 });
    }

    const bytes = Buffer.from(await archive.arrayBuffer());
    if (bytes.length > maxRestoreArchiveBytes) {
      return json({ message: 'Backup archive is larger than the allowed restore upload size.' }, { status: 413 });
    }

    const uploadDir = path.join(os.tmpdir(), 'stackarr-restore-uploads');
    const archivePath = path.join(uploadDir, `${randomUUID()}-${safeArchiveName(originalName)}`);
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(archivePath, bytes, { mode: 0o600 });

    const restorePostgres = formFlag(form, 'restorePostgres', true);
    const restoreNativePlex = formFlag(form, 'restoreNativePlex', false);
    const restorePlexPreferences = formFlag(form, 'restorePlexPreferences', false);
    const forceConfig = formFlag(form, 'forceConfig', true);
    const currentAppRoot = readEnv().APP_ROOT?.trim();
    const command = {
      ...commandRegistry.RestoreBackup,
      args: [
        'backup',
        'restore',
        archivePath,
        '--yes',
        '--mark-onboarding-complete',
        '--delete-archive-after-restore',
        '--constrain-runtime-roots',
        currentAppRoot ? '--restore-app-root' : '',
        currentAppRoot || '',
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
  } finally {
    activeRestoreUploads = Math.max(0, activeRestoreUploads - 1);
  }
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value === 'object' && 'arrayBuffer' in value && 'name' in value && 'size' in value);
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

function claimRestoreUploadAttempt(request: NextRequest) {
  const now = Date.now();
  const key = clientAddress(request);
  const existing = restoreUploadBuckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : {
          attempts: 0,
          resetAt: now + restoreUploadWindowMs
        };

  bucket.attempts += 1;
  restoreUploadBuckets.set(key, bucket);
  pruneRestoreUploadBuckets(now);

  if (bucket.attempts > restoreUploadMaxAttempts) {
    return { retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  return null;
}

function clientAddress(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

function pruneRestoreUploadBuckets(now: number) {
  if (restoreUploadBuckets.size <= 500) {
    return;
  }

  for (const [key, bucket] of restoreUploadBuckets) {
    if (bucket.resetAt <= now) {
      restoreUploadBuckets.delete(key);
    }

    if (restoreUploadBuckets.size <= 400) {
      return;
    }
  }
}
