import { readJsonSetting, writeJsonSetting } from '../database';
import { readEnv } from '../env';
import { decryptSecret, encryptSecret } from '../vault';
import {
  findStreamripField,
  getStreamripDefaultConfig,
  type StreamripConfigGroup,
  streamripConfigFields,
  streamripConfigGroups
} from './schema';

const settingKey = 'stackarr.streamripConfig';
export const redactedSecretValue = '********';

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
    if (field.secret && isRedactedSecret(rawValue)) continue;
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
  const stateRoot = getStreamripStateRoot(env);
  const forceManagedDatabasePaths =
    Boolean(process.env.STREAMRIP_STATE_ROOT) || (env.STACKARR_RUNTIME ?? process.env.STACKARR_RUNTIME) === 'docker';
  config.downloads.folder ||= `${env.DOWNLOADS_ROOT ?? `${env.APP_ROOT ?? '.stackarr'}/downloads`}/streamrip`;
  if (forceManagedDatabasePaths || !config.database.downloads_path) {
    config.database.downloads_path = `${stateRoot}/downloads.db`;
  }
  if (forceManagedDatabasePaths || !config.database.failed_downloads_path) {
    config.database.failed_downloads_path = `${stateRoot}/failed_downloads.db`;
  }
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

function redactStreamripConfig(config: StreamripConfig) {
  const safe = structuredClone(config) as StreamripConfig;
  for (const field of streamripConfigFields) {
    if (field.secret && safe[field.section]?.[field.name]) {
      safe[field.section][field.name] = redactedSecretValue;
    }
  }
  return safe;
}

function encryptStreamripSecrets(config: StreamripConfig) {
  const encrypted = structuredClone(config) as StreamripConfig;
  for (const field of streamripConfigFields) {
    if (field.secret && encrypted[field.section]?.[field.name]) {
      encrypted[field.section][field.name] = encryptSecret(encrypted[field.section][field.name]);
    }
  }
  return encrypted;
}

function decryptStreamripSecrets(config: Partial<StreamripConfig>) {
  const decrypted = structuredClone(config ?? {}) as Partial<StreamripConfig>;
  for (const field of streamripConfigFields) {
    if (field.secret && decrypted[field.section]?.[field.name]) {
      decrypted[field.section]![field.name] = decryptSecret(decrypted[field.section]![field.name]);
    }
  }
  return decrypted;
}

function normalizeStreamripValue(field: { id?: string; type: string; defaultValue: unknown }, value: unknown) {
  if (field.type === 'checkbox') return Boolean(value);
  if (field.type === 'number') return Number(value) || 0;
  if (field.type === 'select' && typeof field.defaultValue === 'number') return Number(value) || 0;
  if (field.type === 'json') return value ?? [];
  if (field.id === 'deezer.arl') return normalizeDeezerArl(value);
  return String(value ?? '');
}

function isRedactedSecret(value: unknown) {
  return typeof value === 'string' && /^\*+$/.test(value);
}

function normalizeDeezerArl(value: unknown) {
  const text = String(value ?? '').trim();
  const assignment = /^arl\s*=\s*(.+)$/i.exec(text);
  const candidate = assignment?.[1]?.trim() ?? text;
  return candidate.replace(/^['"]|['"]$/g, '').trim();
}

function tomlValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return JSON.stringify(String(value ?? ''));
}
