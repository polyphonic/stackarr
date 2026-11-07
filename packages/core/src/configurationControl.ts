import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { StackarrEnv } from './env';
import { appDatabasePath } from './paths';
import type { StackarrSettings } from './settings';

const settingKeys: Record<string, readonly string[]> = {
  ui: [
    'theme',
    'showAdvanced',
    'refreshIntervalSeconds',
    'diskWarningThresholdPercent',
    'unifyServiceUrls',
    'serviceFavorites'
  ],
  connect: ['exposeSeerrOnly', 'warnBeforePublicExposure'],
  metadata: ['tinyMediaManagerEnabled', 'plexMetadataMonitoring', 'jellyfinMetadataMonitoring']
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Provisional settings-only comparison; no generic MCP commit exists. */
export function planConfigurationChange(input: unknown, _current: StackarrEnv, before: StackarrSettings) {
  if (!record(input)) throw new Error('Configuration body must be an object.');
  if (Object.keys(input).some((key) => key !== 'settings'))
    throw new Error(
      'Environment, scheduler, credential, proof and host-owned inputs are unavailable through this MCP preview.'
    );
  if (!record(input.settings)) throw new Error('settings must be an object.');
  const changedSettings: string[] = [];
  for (const [section, fields] of Object.entries(input.settings)) {
    if (!settingKeys[section] || !record(fields)) throw new Error(`Unsupported settings section: ${section}`);
    for (const [key, value] of Object.entries(fields)) {
      if (!settingKeys[section].includes(key))
        throw new Error(`Unsupported or host-owned settings field: ${section}.${key}`);
      const previous = (before as unknown as Record<string, Record<string, unknown>>)[section]?.[key];
      if (
        typeof value !== typeof previous ||
        value === null ||
        (typeof value === 'number' && !Number.isSafeInteger(value)) ||
        (typeof value === 'string' &&
          (value.length > 200 || (key === 'theme' && !['light', 'dark', 'system'].includes(value)))) ||
        (Array.isArray(previous) &&
          (!Array.isArray(value) ||
            value.length > 50 ||
            !value.every((item) => typeof item === 'string' && item.length <= 100))) ||
        (!Array.isArray(previous) && Array.isArray(value))
      )
        throw new Error(`Invalid settings value: ${section}.${key}`);
      if (
        (key === 'refreshIntervalSeconds' && (Number(value) < 5 || Number(value) > 3600)) ||
        (key === 'diskWarningThresholdPercent' && (Number(value) < 1 || Number(value) > 100))
      )
        throw new Error(`Settings value out of range: ${section}.${key}`);
      if (JSON.stringify(value) !== JSON.stringify(previous)) changedSettings.push(`${section}.${key}`);
    }
  }
  if (!changedSettings.length) throw new Error('Supply at least one changed supported settings field.');
  return {
    accepted: true,
    changedSettings,
    provisional: true,
    confirmationRequired: false,
    note: 'Snapshot-only comparison, not an exact save plan. Values can drift; use authenticated settings or specialized tools. Generic MCP writes are unavailable.'
  };
}

/** Never call readEnv/readSettings here: they can initialize defaults. */
export function readExistingConfigurationSnapshot() {
  if (process.env.STACKARR_DATABASE_MODE?.trim().toLowerCase() === 'postgres' || process.env.STACKARR_DATABASE_URL)
    throw new Error(
      'Read-only configuration snapshot is unavailable on PostgreSQL until a non-migrating reader exists.'
    );
  if (!fs.existsSync(appDatabasePath))
    throw new Error('Configuration is not initialized; no defaults were initialized.');
  const db = new DatabaseSync(appDatabasePath, { readOnly: true });
  try {
    const get = (key: string) => {
      const row = db.prepare('select value from app_settings where key = ?').get(key) as { value?: string } | undefined;
      return row?.value ? JSON.parse(row.value) : null;
    };
    const env = get('stackarr.runtimeConfig') as StackarrEnv | null;
    const settings = get('stackarr.settings') as StackarrSettings | null;
    if (!env || !settings) throw new Error('Configuration is not initialized; no defaults were initialized.');
    return { env, settings };
  } catch {
    throw new Error('Configuration snapshot is unavailable or invalid; no defaults were initialized.');
  } finally {
    db.close();
  }
}
