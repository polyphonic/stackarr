import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const common = path.join(repo, 'stackarr/lib/common.sh');

function fixture(
  run: (paths: {
    app: string;
    config: string;
    state: string;
    archive: string;
    project: string;
    invoke: () => { code: number; output: string };
  }) => void
) {
  const root = mkdtempSync(path.join(tmpdir(), 'stackarr-legacy-mount-'));
  const app = path.join(root, 'app');
  const config = path.join(root, 'relocated-config');
  const state = path.join(root, 'relocated-state');
  const archive = path.join(state, 'torrent-archive');
  const project = path.join(root, 'compose');
  mkdirSync(app, { recursive: true });
  const invoke = () => {
    try {
      const output = execFileSync(
        'bash',
        [
          '-c',
          'source "$1"; docker(){ if [[ "$1" == compose ]]; then printf "COMPOSE_CALLED\\n"; fi; }; stackarr_compose up -d',
          'bash',
          common
        ],
        {
          cwd: repo,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            APP_ROOT: app,
            CONFIG_ROOT: config,
            STATE_ROOT: state,
            TORRENT_ARCHIVE_ROOT: archive,
            STACKARR_COMPOSE_PROJECT_DIR: project,
            STACKARR_STORAGE_POLICY: ''
          }
        }
      );
      return { code: 0, output };
    } catch (error) {
      const failure = error as { status: number; stderr: Buffer; stdout: Buffer };
      return { code: failure.status, output: `${failure.stdout}${failure.stderr}` };
    }
  };
  try {
    run({ app, config, state, archive, project, invoke });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function populate(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'fixture');
}

test('populated legacy config bind cannot switch to empty relocated config (including partial cutover)', () =>
  fixture(({ app, config, project, invoke }) => {
    populate(path.join(app, 'config/prowlarr/config.xml'));
    mkdirSync(path.join(config, 'prowlarr'), { recursive: true });
    populate(path.join(config, 'sonarr/config.xml'));
    const result = invoke();
    assert.equal(result.code, 1);
    assert.match(result.output, /config\/prowlarr: populated legacy bind/);
    assert.equal(existsSync(project), false);
  }));

test('populated legacy archive cannot switch to empty independent state root', () =>
  fixture(({ app, project, invoke }) => {
    populate(path.join(app, 'state/torrent-archive/Movies/source.torrent'));
    const result = invoke();
    assert.equal(result.code, 1);
    assert.match(result.output, /torrent-archive: populated legacy bind/);
    assert.equal(existsSync(project), false);
  }));

test('every changed downloader, Arr and hook config bind rejects an empty destination', () => {
  for (const service of ['transmission', 'qbittorrent', 'sonarr', 'sonarr4k', 'radarr', 'radarr4k', 'hooks']) {
    fixture(({ app, config, project, invoke }) => {
      populate(path.join(app, 'config', service, 'existing-state'));
      mkdirSync(path.join(config, service), { recursive: true });
      const result = invoke();
      assert.equal(result.code, 1, service);
      assert.ok(result.output.includes(`config/${service}: populated legacy bind`), result.output);
      assert.equal(existsSync(project), false);
    });
  }
});

test('unchanged roots and physical config alias remain valid', () =>
  fixture(({ app, state, project, invoke }) => {
    populate(path.join(app, 'config/prowlarr/config.xml'));
    populate(path.join(app, 'state/torrent-archive/source.torrent'));
    const config = path.join(app, 'config');
    symlinkSync(config, path.join(path.dirname(state), 'alias-config'));
    const result = execFileSync(
      'bash',
      [
        '-c',
        'source "$1"; docker(){ if [[ "$1" == compose ]]; then printf "COMPOSE_CALLED\\n"; fi; }; stackarr_compose up -d',
        'bash',
        common
      ],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_ROOT: app,
          CONFIG_ROOT: path.join(path.dirname(state), 'alias-config'),
          STATE_ROOT: path.join(app, 'state'),
          TORRENT_ARCHIVE_ROOT: path.join(app, 'state/torrent-archive'),
          STACKARR_COMPOSE_PROJECT_DIR: project,
          STACKARR_STORAGE_POLICY: ''
        }
      }
    );
    assert.equal(result, 'COMPOSE_CALLED\n');
    assert.ok(readFileSync(path.join(project, 'docker-compose.yml'), 'utf8').includes('prowlarr'));
  }));

test('installed storage relocation alias keeps old logical config mount on the migrated tree', () =>
  fixture(({ app, config, project, invoke }) => {
    populate(path.join(config, 'prowlarr/config.xml'));
    symlinkSync(config, path.join(app, 'config'));
    assert.equal(invoke().code, 0);
    assert.ok(existsSync(path.join(project, 'docker-compose.yml')));
  }));

test('custom migrated config and archive with populated destinations pass preflight', () =>
  fixture(({ app, config, archive, project, invoke }) => {
    populate(path.join(app, 'config/prowlarr/config.xml'));
    populate(path.join(app, 'state/torrent-archive/source.torrent'));
    populate(path.join(config, 'prowlarr/config.xml'));
    populate(path.join(archive, 'source.torrent'));
    assert.equal(invoke().code, 0);
    assert.ok(existsSync(path.join(project, 'docker-compose.yml')));
  }));

test('non-directory destination fails closed before Compose launch', () =>
  fixture(({ app, config, project, invoke }) => {
    populate(path.join(app, 'config/prowlarr/config.xml'));
    populate(path.join(config, 'prowlarr'));
    const result = invoke();
    assert.equal(result.code, 1);
    assert.match(result.output, /mount source is not a directory/);
    assert.doesNotMatch(result.output, /COMPOSE_CALLED/);
    assert.equal(existsSync(project), false);
  }));

test('dangling alias fails closed without creating a generated Compose project', () =>
  fixture(({ app, project, invoke }) => {
    mkdirSync(path.join(app, 'config'), { recursive: true });
    symlinkSync(path.join(app, 'missing'), path.join(app, 'config/prowlarr'));
    const result = invoke();
    assert.equal(result.code, 1);
    assert.match(result.output, /Legacy Compose mount check/);
    assert.equal(existsSync(project), false);
  }));
