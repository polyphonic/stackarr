import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { transition } = require('../../../stackarr/scripts/controller-upgrade.cjs');
const common = readFileSync(new URL('../../../stackarr/lib/common.sh', import.meta.url), 'utf8');
const update = readFileSync(new URL('../../../stackarr/scripts/update-run.sh', import.meta.url), 'utf8');
const args = [
  'compose',
  '--project-name',
  'fixture',
  '-f',
  '/fixture/compose.yml',
  '--profile',
  'stackarr',
  'up',
  '-d',
  '--force-recreate',
  '--no-deps',
  'stackarr'
];

// Previous release's Compose labels/env and persistence contract, not name-only ownership.
function container(service: string, digit: string, running = true) {
  return {
    Id: digit.repeat(64),
    Name: `/${service}`,
    RestartCount: 0,
    Config: {
      Labels: {
        'com.docker.compose.project': 'fixture',
        'com.docker.compose.service': service,
        'com.docker.compose.oneoff': 'False',
        'org.opencontainers.image.title': 'Stackarr'
      },
      Env: ['STACKARR_RUNTIME=docker', `STACKARR_CONTAINER_NAME=${service}`]
    },
    State: { Running: running, Status: running ? 'running' : 'exited' },
    HostConfig: { RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 } },
    Mounts: [
      { Type: 'bind', Source: '/fixture/config', Destination: '/stackarr-config', RW: true },
      { Type: 'volume', Name: 'fixture_stackarr-state', Destination: '/stackarr-state', RW: true }
    ]
  };
}
function fixture() {
  const old = container('app', 'a');
  const next = container('stackarr', 'b');
  const other = container('radarr', 'c');
  const state = new Map([old, other].map((c) => [c.Id, structuredClone(c)]));
  const calls: string[][] = [];
  const config = {
    services: {
      stackarr: {
        volumes: [
          { type: 'bind', source: '/fixture/config', target: '/stackarr-config' },
          { type: 'volume', source: 'stackarr-state', target: '/stackarr-state' }
        ]
      }
    },
    volumes: { 'stackarr-state': { name: 'fixture_stackarr-state' } }
  };
  const f = {
    old,
    next,
    other,
    state,
    calls,
    config,
    failure: '',
    docker(command: string[]) {
      calls.push(command);
      const id = command.at(-1)!;
      if (command[0] === 'ps') {
        const service = id.split('=').at(-1);
        return [...state.values()]
          .filter((c) => c.Config.Labels['com.docker.compose.service'] === service)
          .map((c) => c.Id)
          .join('\n');
      }
      if (command[0] === 'inspect') {
        assert.ok(state.has(id));
        return JSON.stringify([state.get(id)]);
      }
      if (command[0] === 'compose') {
        if (command.includes('config')) return JSON.stringify(config);
        if (f.failure === 'create') throw new Error('create failed');
        // This assertion reproduces the old bug: a second controller cannot bind the port.
        assert.equal(state.get(old.Id)?.State.Running, false);
        state.set(next.Id, structuredClone(next));
        if (f.failure === 'partial') throw new Error('partial create');
        return '';
      }
      if (command[0] === 'exec') {
        assert.equal(command[1], next.Id);
        if (f.failure === 'health') throw new Error('unhealthy');
        assert.ok(state.has(old.Id), 'retain old object until replacement is healthy');
        return '';
      }
      const c = state.get(id)!;
      assert.ok(c && c.Id !== other.Id, 'never mutate unrelated services');
      if (command[0] === 'update') {
        const [name, retry] = command[1].split('=')[1].split(':');
        c.HostConfig.RestartPolicy = { Name: name, MaximumRetryCount: Number(retry || 0) };
      } else if (command[0] === 'stop' || command[0] === 'start') {
        c.State = { Running: command[0] === 'start', Status: command[0] === 'start' ? 'running' : 'exited' };
      } else if (command[0] === 'rm') {
        assert.equal(c.State.Running, false);
        assert.equal(command.length, 2, 'never force-remove or delete volumes');
        state.delete(id);
      } else throw new Error(`Unexpected Docker operation ${command[0]}`);
      return '';
    }
  };
  return f;
}

test('previous controller yields its port before scoped replacement and retires only after health', async () => {
  const f = fixture();
  const result = await transition('fixture', args, f);
  assert.equal(result.migrated, true);
  assert.equal(f.state.has(f.old.Id), false);
  assert.deepEqual(f.state.get(f.next.Id), f.next);
  assert.deepEqual(f.state.get(f.other.Id), f.other);
  assert.ok(f.calls.some((c) => c[0] === 'exec'));
  assert.ok(!f.calls.flat().includes('--remove-orphans'));
});

for (const failure of ['create', 'partial', 'health']) {
  for (const running of [true, false]) {
    test(`legacy controller recovers exact state after ${failure} failure (running=${running})`, async () => {
      const f = fixture();
      f.old.State = { Running: running, Status: running ? 'running' : 'exited' };
      f.old.HostConfig.RestartPolicy = { Name: 'on-failure', MaximumRetryCount: 3 };
      f.state.set(f.old.Id, structuredClone(f.old));
      f.failure = failure;
      await assert.rejects(
        transition('fixture', args, { ...f, timeoutMs: 0 }),
        /original controller and restart policy restored/
      );
      assert.deepEqual(f.state.get(f.old.Id), f.old);
      assert.deepEqual(f.state.get(f.other.Id), f.other);
      assert.equal(f.state.has(f.next.Id), false);
    });
  }
}

for (const defect of ['project', 'identity', 'ambiguous', 'storage', 'broad']) {
  test(`legacy transition fails before mutation for ${defect}`, async () => {
    const f = fixture();
    if (defect === 'project') f.state.get(f.old.Id)!.Config.Labels['com.docker.compose.project'] = 'other';
    if (defect === 'identity') f.state.get(f.old.Id)!.Config.Env = [];
    if (defect === 'ambiguous') f.state.set(f.next.Id, f.next);
    if (defect === 'storage') f.config.services.stackarr.volumes[0].source = '/other/config';
    const command = defect === 'broad' ? [...args.slice(0, -1), '--remove-orphans', 'stackarr'] : args;
    await assert.rejects(transition('fixture', command, f));
    assert.ok(!f.calls.some((c) => ['stop', 'update', 'rm', 'start'].includes(c[0])));
  });
}

test('already renamed and fresh installs pass through without legacy mutation', async () => {
  for (const modern of [true, false]) {
    const f = fixture();
    f.state.delete(f.old.Id);
    if (modern) f.state.set(f.next.Id, f.next);
    const docker = (command: string[]) => (command[0] === 'compose' ? (f.calls.push(command), '') : f.docker(command));
    assert.equal((await transition('fixture', args, { docker })).migrated, false);
    assert.deepEqual(
      f.calls.map((c) => c[0]),
      ['ps', 'compose']
    );
  }
});

test('real Compose wrapper routes only scoped controller up through transition helper', () => {
  const body = common.match(/stackarr_compose\(\) \{[\s\S]*?\n\}/)![0];
  const script = `set -eu
ROOT_DIR=/fixture
configure_docker_environment() { :; }
stackarr_storage_guard() { :; }
stackarr_verify_legacy_compose_mounts() { :; }
prepare_compose_runtime_file() { :; }
stackarr_compose_project_dir() { printf /fixture; }
stackarr_compose_file() { printf /fixture/compose.yml; }
migrate_legacy_image_volumes() { :; }
node() { printf 'NODE %s\\n' "$*"; }
docker() { printf 'DOCKER %s\\n' "$*"; }
${body}
stackarr_compose --profile stackarr up -d --no-deps stackarr
stackarr_compose --profile stackarr pull stackarr
stackarr_compose up -d --no-deps radarr
stackarr_compose up -d --remove-orphans
`;
  const result = spawnSync('bash', [], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.match(lines[0], /^NODE \/fixture\/scripts\/controller-upgrade.cjs stackarr docker compose/);
  assert.ok(lines.slice(1).every((line) => line.startsWith('DOCKER compose')));
});

test('actual updater decision retains local aliases without calling a worker', () => {
  const local = update.match(/stackarr_image_is_local\(\) \{[\s\S]*?\n\}/)![0];
  const app = update.match(/update_stackarr_app\(\) \{[\s\S]*?\n\}/)![0];
  for (const [image, expected] of [
    ['candidate:local', 'retained'],
    ['candidate:review', 'worker'],
    ['polyphonic/stackarr:alpha', 'worker']
  ]) {
    const result = spawnSync('bash', [], {
      input: `set -eu\nwarn() { :; }\nstart_app_update_worker() { printf worker; }\n${local}\n${app}\nSTACKARR_IMAGE=${image}\nupdate_stackarr_app\n`,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout || 'retained', expected);
  }
});
