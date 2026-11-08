import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = fileURLToPath(new URL('../../../', import.meta.url));

async function shellFunction(name: string): Promise<string> {
  const source = await readFile(path.join(root, 'stackarr/scripts/configure.sh'), 'utf8');
  const start = source.indexOf(`${name}() {\n`);
  assert.notEqual(start, -1);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

test('Seerr request payloads serialize canonical paths with spaces and preserve legacy fallback', async () => {
  const code = [
    await shellFunction('seerr_radarr_payload'),
    'season_folders_enabled_json() { printf true; }',
    await shellFunction('seerr_sonarr_payload'),
    'seerr_radarr_payload Radarr radarr 7878 fixture 1 HD false true http://localhost:7878',
    'seerr_sonarr_payload Sonarr sonarr 8989 fixture 1 HD false true http://localhost:8989'
  ].join('\n');
  for (const [movies, tv] of [
    [undefined, undefined],
    ['/data/Movies Library', '/data/TV Shows']
  ] as const) {
    const env = { ...process.env, CONTAINER_MOVIES_ROOT: movies || '', CONTAINER_TV_ROOT: tv || '' };
    const { stdout } = await execFile('bash', ['-c', code], { env });
    const [radarr, sonarr] = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(radarr.activeDirectory, movies || '/movies');
    assert.equal(sonarr.activeDirectory, tv || '/tv');
    assert.equal(sonarr.activeAnimeDirectory, tv || '/tv');
  }
});

test('Seerr updates preserve existing roots while new records use canonical paths', async () => {
  const code = [
    await shellFunction('ensure_seerr_service'),
    'json_id_by_name() { printf "42\\n"; }',
    'curl() { printf %s \'[{"id":42,"activeDirectory":"/movies","activeAnimeDirectory":"/tv"}]\'; }',
    'api_put_json() { printf "%s\\n" "$4"; }',
    'api_post_json() { return 99; }',
    'warn() { return 0; }',
    `ensure_seerr_service label list create update key Sonarr '{"activeDirectory":"/data/TV Shows","activeAnimeDirectory":"/data/TV Shows"}'`
  ].join('\n');
  const { stdout } = await execFile('bash', ['-e', '-c', code]);
  assert.deepEqual(JSON.parse(stdout), { activeDirectory: '/movies', activeAnimeDirectory: '/tv' });
});

test('permissions audit uses effective media paths for shared and independent downloads', async () => {
  const source = await readFile(path.join(root, 'stackarr/scripts/permissions.sh'), 'utf8');
  const start = source.indexOf('audit_docker_mounts() {\n');
  const end = source.indexOf('\n}\n', start);
  for (const downloads of ['/downloads', '/data/Downloads', '/external/downloads']) {
    const code = [
      source.slice(start, end + 3),
      'test_path_access() { :; }; docker_compose_available() { :; }',
      'selected_torrent_client() { printf transmission; }; flag_enabled() { :; }',
      'service_mount_check() { printf "%s|%s\\n" "$1" "$3"; }',
      'audit_docker_mounts'
    ].join('\n');
    const { stdout } = await execFile('bash', ['-e', '-c', code], {
      env: {
        ...process.env,
        CONTAINER_DOWNLOADS_ROOT: downloads,
        CONTAINER_MOVIES_ROOT: '/data/Movies',
        CONTAINER_TV_ROOT: '/data/TV Shows'
      }
    });
    assert.ok(stdout.includes(`transmission|${downloads}\n`));
    assert.ok(stdout.includes('radarr|/data/Movies\n'));
    assert.ok(stdout.includes('sonarr|/data/TV Shows\n'));
  }
});
