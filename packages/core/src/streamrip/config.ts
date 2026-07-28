import path from 'node:path';
import { readJsonSetting, writeJsonSetting } from '../database';
import { readEnv, redactSecretValue } from '../env';
import { decryptSecret, encryptSecret } from '../vault';
import {
  findStreamripField,
  getStreamripDefaultConfig,
  type StreamripConfigGroup,
  streamripConfigFields,
  streamripConfigGroups
} from './schema';

const settingKey = 'stackarr.streamripConfig';
export type StreamripConfig = Record<string, Record<string, unknown>>;

export function readStreamripConfig(options: { redactSecrets?: boolean } = {}) {
  const stored = decryptStreamripSecrets(readJsonSetting<Partial<StreamripConfig>>(settingKey, {}));
  const config = mergeStreamripConfig(stored);
  applyRuntimeDefaults(config);
  return options.redactSecrets === false ? config : redactStreamripConfig(config);
}

export function updateStreamripConfig(values: Record<string, unknown>) {
  const current = readStreamripConfig({ redactSecrets: false });
  const next = structuredClone(current) as StreamripConfig;

  for (const [id, rawValue] of Object.entries(values)) {
    const field = findStreamripField(id);
    if (!field) continue;
    if (field.secret && isRedactedSecret(rawValue, current[field.section]?.[field.name])) continue;
    next[field.section][field.name] = normalizeStreamripValue(field, rawValue);
  }

  writeJsonSetting(settingKey, encryptStreamripSecrets(next));
  return readStreamripConfig();
}

export function getStreamripServiceConfigGroups(): StreamripConfigGroup[] {
  const config = readStreamripConfig();
  return streamripConfigGroups.map((group) => ({
    ...group,
    fields: group.fields.map((field) => ({
      ...field,
      defaultValue: config[field.section]?.[field.name] ?? field.defaultValue
    }))
  }));
}

export function renderStreamripToml(config = readStreamripConfig({ redactSecrets: false })) {
  return (
    streamripConfigGroups
      .map((group) => {
        const lines = [`[${group.section}]`];
        for (const field of group.fields) {
          lines.push(`${field.name} = ${tomlValue(config[field.section]?.[field.name] ?? field.defaultValue)}`);
        }
        return lines.join('\n');
      })
      .join('\n\n') + '\n'
  );
}

function mergeStreamripConfig(stored: Partial<StreamripConfig>) {
  const defaults = getStreamripDefaultConfig() as StreamripConfig;
  const merged = structuredClone(defaults) as StreamripConfig;
  for (const [section, values] of Object.entries(stored ?? {})) {
    if (!values || typeof values !== 'object') continue;
    merged[section] = { ...(merged[section] ?? {}), ...values };
  }
  return merged;
}

function applyRuntimeDefaults(config: StreamripConfig) {
  const env = readEnv();
  const forceManagedDatabasePaths =
    Boolean(process.env.STREAMRIP_STATE_ROOT) || (env.STACKARR_RUNTIME ?? process.env.STACKARR_RUNTIME) === 'docker';
  config.downloads.folder ||= `${env.DOWNLOADS_ROOT ?? `${env.APP_ROOT ?? '.stackarr'}/downloads`}/streamrip`;
  config.database.downloads_path = normalizeStreamripDatabasePath(
    forceManagedDatabasePaths ? '' : config.database.downloads_path,
    'downloads.db'
  );
  config.database.failed_downloads_path = normalizeStreamripDatabasePath(
    forceManagedDatabasePaths ? '' : config.database.failed_downloads_path,
    'failed_downloads.db'
  );
}

export function getStreamripStateRoot(env = readEnv()) {
  if (process.env.STREAMRIP_STATE_ROOT) {
    return process.env.STREAMRIP_STATE_ROOT;
  }

  if ((env.STACKARR_RUNTIME ?? process.env.STACKARR_RUNTIME) === 'docker') {
    return '/stackarr-state/streamrip';
  }

  const stateRoot = env.STATE_ROOT ?? `${env.APP_ROOT ?? ''}/state`;
  return `${stateRoot}/streamrip`;
}

export function normalizeStreamripDatabasePath(
  value: unknown,
  fallbackFileName: 'downloads.db' | 'failed_downloads.db',
  options: { strict?: boolean } = {}
) {
  const root = path.resolve(getStreamripStateRoot());
  const fallback = path.join(root, fallbackFileName);
  const raw = String(value ?? '').trim();
  const candidate = raw ? (path.isAbsolute(raw) ? raw : path.join(root, raw)) : fallback;
  const resolved = path.resolve(candidate);

  if (!isSubpath(root, resolved)) {
    if (options.strict) {
      throw new Error('Streamrip database paths must stay under the managed Streamrip state root.');
    }
    return fallback;
  }

  return resolved;
}

export function isManagedStreamripDatabasePath(value: string) {
  return isSubpath(path.resolve(getStreamripStateRoot()), path.resolve(value));
}

function redactStreamripConfig(config: StreamripConfig) {
  const safe = structuredClone(config) as StreamripConfig;
  for (const field of streamripConfigFields) {
    if (field.secret && hasSecretValue(safe[field.section]?.[field.name])) {
      safe[field.section][field.name] = redactSecretValue(secretPreviewText(safe[field.section]?.[field.name]));
    }
  }
  return safe;
}

function encryptStreamripSecrets(config: StreamripConfig) {
  const encrypted = structuredClone(config) as StreamripConfig;
  for (const field of streamripConfigFields) {
    if (field.secret && hasSecretValue(encrypted[field.section]?.[field.name])) {
      encrypted[field.section][field.name] = encryptStreamripSecretValue(field, encrypted[field.section][field.name]);
    }
  }
  return encrypted;
}

function decryptStreamripSecrets(config: Partial<StreamripConfig>) {
  const decrypted = structuredClone(config ?? {}) as Partial<StreamripConfig>;
  for (const field of streamripConfigFields) {
    if (field.secret && decrypted[field.section]?.[field.name]) {
      try {
        decrypted[field.section]![field.name] = decryptStreamripSecretValue(
          field,
          decrypted[field.section]![field.name]
        );
      } catch {
        decrypted[field.section]![field.name] = '';
      }
    }
  }
  return decrypted;
}

function normalizeStreamripValue(field: { id?: string; type: string; defaultValue: unknown }, value: unknown) {
  if (field.id === 'database.downloads_path') {
    return normalizeStreamripDatabasePath(value, 'downloads.db', { strict: true });
  }
  if (field.id === 'database.failed_downloads_path') {
    return normalizeStreamripDatabasePath(value, 'failed_downloads.db', { strict: true });
  }
  if (field.type === 'checkbox') return Boolean(value);
  if (field.type === 'number') return Number(value) || 0;
  if (field.type === 'select' && typeof field.defaultValue === 'number') return Number(value) || 0;
  if (field.type === 'json') return value ?? [];
  if (field.id === 'deezer.arl') return normalizeDeezerArl(value);
  return String(value ?? '');
}

function isRedactedSecret(value: unknown, currentValue: unknown) {
  return (
    typeof value === 'string' && (/^\*+$/.test(value) || value === redactSecretValue(secretPreviewText(currentValue)))
  );
}

function secretPreviewText(value: unknown) {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value ?? ''));
}

function hasSecretValue(value: unknown) {
  if (typeof value === 'string') {
    return value.length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

function normalizeDeezerArl(value: unknown) {
  const text = String(value ?? '').trim();
  const assignment = /^arl\s*=\s*(.+)$/i.exec(text);
  const candidate = assignment?.[1]?.trim() ?? text;
  return candidate.replace(/^['"]|['"]$/g, '').trim();
}

function encryptStreamripSecretValue(field: { type: string }, value: unknown) {
  if (field.type === 'json') {
    return encryptSecret(JSON.stringify(value ?? []));
  }

  return encryptSecret(value);
}

function decryptStreamripSecretValue(field: { type: string; defaultValue: unknown }, value: unknown) {
  const decrypted = decryptSecret(value);

  if (field.type !== 'json' || typeof decrypted !== 'string') {
    return decrypted;
  }

  try {
    return JSON.parse(decrypted);
  } catch {
    return field.defaultValue;
  }
}

function isSubpath(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function tomlValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return JSON.stringify(String(value ?? ''));
}
