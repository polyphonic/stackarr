import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { StackarrEnv } from './env';

export type PostgresBackupCoverage = { name: string; schema: string; extensions: string[] };
export type PostgresBackupStatus = {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  lastAttempt: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  coverage: PostgresBackupCoverage[];
  generation: string | null;
  bytes: number | null;
  durationSeconds: number | null;
  lastTest: string | null;
  nextRun: string | null;
};

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const configKeys = [
  'STACKARR_PG_BACKUP_ENABLED',
  'STACKARR_PG_BACKUP_URL',
  'STACKARR_PG_BACKUP_SCHEDULE',
  'STACKARR_PG_BACKUP_TIME',
  'STACKARR_PG_BACKUP_WEEKDAY',
  'STACKARR_PG_BACKUP_TIMEZONE'
] as const;

export function validatePostgresBackupConfig(env: StackarrEnv): void {
  if (!['true', 'false'].includes(env.STACKARR_PG_BACKUP_ENABLED ?? 'false'))
    throw new Error('Invalid PostgreSQL backup enabled flag.');
  if (!['daily', 'weekly'].includes(env.STACKARR_PG_BACKUP_SCHEDULE ?? 'daily'))
    throw new Error('Invalid PostgreSQL backup schedule.');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(env.STACKARR_PG_BACKUP_TIME ?? ''))
    throw new Error('Invalid PostgreSQL backup time.');
  if (!weekdays.includes(env.STACKARR_PG_BACKUP_WEEKDAY ?? '')) throw new Error('Invalid PostgreSQL backup weekday.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: env.STACKARR_PG_BACKUP_TIMEZONE }).format();
  } catch {
    throw new Error('Invalid PostgreSQL backup timezone.');
  }
  const raw = env.STACKARR_PG_BACKUP_URL ?? '';
  if (!raw) {
    if (env.STACKARR_PG_BACKUP_ENABLED === 'true') throw new Error('PostgreSQL backup requires a target URL.');
    return;
  }
  // Never include a connection string or its parsed components in validation errors.
  const invalid = () => {
    throw new Error(
      'Invalid PostgreSQL backup target URL. Use a direct, verified-TLS PostgreSQL connection with explicit host, user, password and database.'
    );
  };
  if (/[\x00-\x20\x7f#]/.test(raw) || /%(?![0-9a-fA-F]{2})/.test(raw)) invalid();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    invalid();
    return;
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    !url.pathname ||
    url.pathname === '/' ||
    url.hash ||
    /-pooler(?:\.|$)/i.test(url.hostname) ||
    /[,%]/.test(url.hostname)
  )
    invalid();
  try {
    if (
      /[\x00-\x1f\x7f]/.test(decodeURIComponent(url.username)) ||
      /[\x00-\x1f\x7f]/.test(decodeURIComponent(url.password))
    )
      invalid();
  } catch {
    invalid();
  }
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    invalid();
    return;
  }
  if (!database || database.includes('/') || /[\x00-\x1f\x7f]/.test(database)) invalid();
  const query = raw.split('?')[1] ?? '';
  if (query && query.split('&').some((part) => !part.includes('=') || part.startsWith('='))) invalid();
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || !['sslmode', 'channel_binding'].includes(key)) invalid();
    seen.add(key);
    if (key === 'sslmode' && !['require', 'verify-full'].includes(value)) invalid();
    if (key === 'channel_binding' && !['require', 'prefer'].includes(value)) invalid();
  }
}

export function postgresBackupTargetIdentity(env: StackarrEnv): string | null {
  if (!env.STACKARR_PG_BACKUP_URL) return null;
  try {
    const url = new URL(env.STACKARR_PG_BACKUP_URL);
    const scope = [
      url.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
      Number(url.port || 5432),
      decodeURIComponent(url.pathname.slice(1)),
      decodeURIComponent(url.username)
    ];
    return createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  } catch {
    return null;
  }
}

export function postgresBackupPublicConfig(env: StackarrEnv) {
  return Object.fromEntries(
    configKeys.map((key) => [key, key === 'STACKARR_PG_BACKUP_URL' ? (env[key] ? '********' : '') : (env[key] ?? '')])
  );
}

export function nextPostgresBackupRun(env: StackarrEnv, now = new Date()): string | null {
  if (env.STACKARR_PG_BACKUP_ENABLED !== 'true') return null;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: env.STACKARR_PG_BACKUP_TIMEZONE ?? 'Etc/UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short'
  });
  const [hour, minute] = (env.STACKARR_PG_BACKUP_TIME ?? '03:00').split(':');
  // Search UTC minutes to resolve local DST gaps and folds to the first actual occurrence.
  const start = Math.floor(now.getTime() / 60000) * 60000 + 60000;
  for (let offset = 0; offset < 15 * 24 * 60; offset++) {
    const candidate = new Date(start + offset * 60000);
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map((part) => [part.type, part.value]));
    if (
      parts.hour === hour &&
      parts.minute === minute &&
      (env.STACKARR_PG_BACKUP_SCHEDULE !== 'weekly' || parts.weekday === env.STACKARR_PG_BACKUP_WEEKDAY)
    ) {
      // A fall-back hour has two UTC instants. Never schedule the second occurrence.
      const repeated = Array.from(
        { length: 180 },
        (_, index) => new Date(candidate.getTime() - (index + 1) * 60000)
      ).some((earlier) => {
        const previous = Object.fromEntries(formatter.formatToParts(earlier).map((part) => [part.type, part.value]));
        return (
          previous.year === parts.year &&
          previous.month === parts.month &&
          previous.day === parts.day &&
          previous.hour === hour &&
          previous.minute === minute
        );
      });
      if (!repeated) return candidate.toISOString();
    }
  }
  return null;
}

export function getPostgresBackupStatusAction(env: StackarrEnv, now = new Date()): PostgresBackupStatus {
  const empty: PostgresBackupStatus = {
    state: 'idle',
    lastAttempt: null,
    lastSuccess: null,
    lastError: null,
    coverage: [],
    generation: null,
    bytes: null,
    durationSeconds: null,
    lastTest: null,
    nextRun: null
  };
  let cached: Record<string, unknown> = {};
  try {
    const file = path.join(env.STATE_ROOT ?? '', 'postgres-backup', 'status.json');
    const stat = fs.lstatSync(file);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size < 1024 * 1024)
      cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* Missing or malformed cache is an idle status, never a remote probe. */
  }
  if (!cached || Array.isArray(cached) || cached.targetIdentity !== postgresBackupTargetIdentity(env)) cached = {};
  if (cached.state === 'running') {
    // Probe the local kernel lock, not a PID that may have been reused after restart.
    const probe = spawnSync(
      'python3',
      [
        '-c',
        `import fcntl,sys
try:
    with open(sys.argv[1], 'r') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(3)
except FileNotFoundError:
    pass
`,
        path.join(env.STATE_ROOT ?? '', 'postgres-backup', 'active.lock')
      ],
      { timeout: 1000, encoding: 'utf8' }
    );
    if (probe.status !== 3)
      cached = { ...cached, state: 'failed', lastError: 'Previous attempt stopped or cannot be verified.' };
  }
  const status = {
    ...empty,
    ...Object.fromEntries(
      Object.keys(empty)
        .filter((key) => key !== 'nextRun' && Object.hasOwn(cached, key))
        .map((key) => [key, cached[key]])
    ),
    nextRun: nextPostgresBackupRun(env, now)
  } as PostgresBackupStatus;
  if (!['idle', 'running', 'succeeded', 'failed'].includes(status.state)) status.state = 'idle';
  if (!Array.isArray(status.coverage)) status.coverage = [];
  // Driver exceptions can embed a full URL or only credentials. Do not expose raw errors.
  if (status.lastError) status.lastError = 'Backup failed; inspect local backup logs.';
  return status;
}
