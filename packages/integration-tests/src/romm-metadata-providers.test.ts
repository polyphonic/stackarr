import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = require.resolve('tsx');

const expectedProviderEnv = [
  'IGDB_CLIENT_ID: ${ROMM_IGDB_CLIENT_ID:-}',
  'IGDB_CLIENT_SECRET: ${ROMM_IGDB_CLIENT_SECRET:-}',
  'SCREENSCRAPER_USER: ${ROMM_SCREENSCRAPER_USER:-}',
  'SCREENSCRAPER_PASSWORD: ${ROMM_SCREENSCRAPER_PASSWORD:-}',
  'MOBYGAMES_API_KEY: ${ROMM_MOBYGAMES_API_KEY:-}',
  'RETROACHIEVEMENTS_API_KEY: ${ROMM_RETROACHIEVEMENTS_API_KEY:-}',
  'STEAMGRIDDB_API_KEY: ${ROMM_STEAMGRIDDB_API_KEY:-}',
  'HASHEOUS_API_ENABLED: ${ROMM_HASHEOUS_API_ENABLED:-true}',
  'PLAYMATCH_API_ENABLED: ${ROMM_PLAYMATCH_API_ENABLED:-false}',
  'LAUNCHBOX_API_ENABLED: ${ROMM_LAUNCHBOX_API_ENABLED:-false}',
  'FLASHPOINT_API_ENABLED: ${ROMM_FLASHPOINT_API_ENABLED:-false}',
  'HLTB_API_ENABLED: ${ROMM_HLTB_API_ENABLED:-false}',
  'TGDB_API_ENABLED: ${ROMM_TGDB_API_ENABLED:-false}'
];

test('RomM Compose keeps every configurable metadata provider wired without blanking image credentials', async () => {
  const compose = await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8');

  for (const mapping of expectedProviderEnv) assert.equal(compose.includes(mapping), true, mapping);
  assert.doesNotMatch(compose, /SCREENSCRAPER_DEV_(?:ID|PASSWORD):/);
});

test('RomM service settings expose ScreenScraper.fr and the complete provider field set', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-romm-provider-config-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { getServiceConfigAction } = await import('./packages/core/src/serviceCatalog.ts');
          const config = getServiceConfigAction({ service: 'romm' });
          const group = config.groups.find(({ title }) => title === 'Metadata Providers');
          console.log(JSON.stringify({ description: group?.description, fields: group?.fields.map(({ id, label }) => ({ id, label })) }));
        `
      ],
      { cwd: repoRoot, env: { ...process.env, STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db') } }
    );
    const result = JSON.parse(stdout) as { description: string; fields: Array<{ id: string; label: string }> };
    const ids = result.fields.map(({ id }) => id);

    assert.match(result.description, /ES-DE gamelist\.xml/);
    assert.deepEqual(ids, [
      'rommIgdbClientId',
      'rommIgdbClientSecret',
      'rommScreenscraperUser',
      'rommScreenscraperPassword',
      'rommMobyGamesApiKey',
      'rommRetroachievementsApiKey',
      'rommRefreshRetroAchievementsCacheDays',
      'rommSteamGridDbApiKey',
      'rommHasheousApiEnabled',
      'rommPlaymatchApiEnabled',
      'rommLaunchboxApiEnabled',
      'rommScheduledLaunchboxUpdateEnabled',
      'rommScheduledLaunchboxUpdateCron',
      'rommFlashpointApiEnabled',
      'rommHltbApiEnabled',
      'rommTgdbApiEnabled'
    ]);
    assert.equal(result.fields.find(({ id }) => id === 'rommScreenscraperUser')?.label, 'ScreenScraper.fr Username');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('RomM provider tool reports configuration without returning credential values', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-romm-provider-tool-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { writeEnvConfig } = await import('./packages/core/src/env.ts');
          const { getRommMetadataProvidersAction } = await import('./packages/core/src/actions/romm.ts');
          writeEnvConfig({
            ROMM_SCREENSCRAPER_USER: 'provider-user',
            ROMM_SCREENSCRAPER_PASSWORD: 'provider-password',
            ROMM_HASHEOUS_API_ENABLED: 'false'
          });
          console.log(JSON.stringify(getRommMetadataProvidersAction()));
        `
      ],
      { cwd: repoRoot, env: { ...process.env, STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db') } }
    );
    const result = JSON.parse(stdout) as {
      providers: Array<{ id: string; enabled: boolean }>;
      filesystemProviders: Array<{ id: string }>;
    };

    assert.equal(result.providers.find(({ id }) => id === 'screenscraper')?.enabled, true);
    assert.equal(result.providers.find(({ id }) => id === 'hasheous')?.enabled, false);
    assert.deepEqual(
      result.filesystemProviders.map(({ id }) => id),
      ['es-de']
    );
    assert.doesNotMatch(stdout, /provider-user|provider-password/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
