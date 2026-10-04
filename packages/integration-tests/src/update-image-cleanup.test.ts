import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function cleanupCommand() {
  const compose = await readFile(path.join(repoRoot, 'stackarr/docker-compose.yml'), 'utf8');
  const block = compose.match(/  image-cleanup:\n[\s\S]*?      - \|\n([\s\S]*?)\n    volumes:/)?.[1];
  assert.ok(block, 'image cleanup Python command exists');
  return block
    .split('\n')
    .map((line) => line.replace(/^        /, ''))
    .join('\n');
}

type Image = { id: string; tags: string[] };

async function mockEngine(options: { failList?: boolean; raceReference?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-image-cleanup-'));
  const socketPath = path.join(root, 'docker.sock');
  const images = new Map<string, Image>([
    [
      'sha256:protected',
      { id: 'sha256:protected', tags: ['family-dad-rollback:latest', 'family-rollback:latest', 'family:latest'] }
    ],
    ['sha256:unused', { id: 'sha256:unused', tags: ['unused:first', 'unused:second'] }],
    ['sha256:dangling', { id: 'sha256:dangling', tags: [] }]
  ]);
  const refs = new Set(['sha256:protected']);
  const requests: string[] = [];
  const server = createServer((socket) => {
    socket.once('data', (chunk) => {
      const [method, pathName] = chunk.toString().split(' ');
      requests.push(`${method} ${pathName}`);
      let status = 200;
      let body: unknown = {};
      if (method === 'GET' && pathName === '/images/json?all=1') {
        status = options.failList ? 500 : 200;
        body =
          status === 200
            ? [...images.values()].map(({ id, tags }) => ({ Id: id, RepoTags: tags }))
            : { message: 'list refused' };
      } else if (method === 'GET' && pathName === '/containers/json?all=1') {
        body = [...refs].map((id) => ({ ImageID: id, Image: 'irrelevant:tag' }));
      } else if (method === 'GET' && pathName.startsWith('/images/') && pathName.endsWith('/json')) {
        const id = decodeURIComponent(pathName.slice('/images/'.length, -'/json'.length));
        const image = images.get(id);
        status = image ? 200 : 404;
        body = image ? { Id: id, RepoTags: image.tags } : { message: 'not found' };
      } else if (method === 'DELETE' && pathName.startsWith('/images/')) {
        const ref = decodeURIComponent(pathName.slice('/images/'.length));
        const image = images.get(ref) ?? [...images.values()].find((entry) => entry.tags.includes(ref));
        if (options.raceReference && ref === options.raceReference) refs.add('sha256:unused');
        if (!image) {
          status = 404;
        } else if (refs.has(image.id)) {
          status = 409;
        } else if (image.id === ref && image.tags.length > 1) {
          status = 409;
        } else {
          if (image.id !== ref) image.tags.splice(image.tags.indexOf(ref), 1);
          if (image.id === ref || image.tags.length === 0) images.delete(image.id);
          body = [{ Deleted: image.id }];
        }
      } else {
        status = 500;
        body = { message: 'unexpected endpoint' };
      }
      const payload = JSON.stringify(body);
      socket.end(
        `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Error'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    const script = (await cleanupCommand()).replace('/var/run/docker.sock', socketPath);
    const result = await execFile('python3', ['-c', script]).then(
      ({ stdout, stderr }) => ({ output: stdout + stderr, failed: false }),
      (error: Error & { stdout: string; stderr: string }) => ({ output: error.stdout + error.stderr, failed: true })
    );
    return { ...result, requests, images };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

test('cleanup preserves all tags on stopped-container image and deletes unused multi-tag and dangling IDs', async () => {
  const result = await mockEngine();
  assert.equal(result.failed, false, result.output);
  assert.deepEqual(result.images.get('sha256:protected')?.tags, [
    'family-dad-rollback:latest',
    'family-rollback:latest',
    'family:latest'
  ]);
  assert.equal(result.images.has('sha256:unused'), false);
  assert.equal(result.images.has('sha256:dangling'), false);
  assert.ok(result.requests.includes('DELETE /images/unused%3Afirst'));
  assert.ok(result.requests.includes('DELETE /images/unused%3Asecond'));
  assert.ok(result.requests.every((request) => !request.startsWith('POST ') && !request.includes('force=true')));
  assert.ok(result.requests.every((request) => !request.startsWith('DELETE /images/family')));
  assert.match(result.output, /Deleted image: sha256:unused/);
  assert.match(result.output, /Deleted image: sha256:dangling/);
  assert.match(result.output, /Reclaimed bytes: unavailable/);
});

test('cleanup fails closed when image inventory fails', async () => {
  const result = await mockEngine({ failList: true });
  assert.equal(result.failed, true);
  assert.match(result.output, /Docker GET \/images\/json\?all=1 failed \(HTTP 500\)/);
  assert.equal(
    result.requests.some((request) => request.startsWith('DELETE ')),
    false
  );
});

test('cleanup stops tag removals if a container begins referencing an image', async () => {
  const result = await mockEngine({ raceReference: 'sha256:unused' });
  assert.equal(result.failed, false, result.output);
  assert.deepEqual(result.images.get('sha256:unused')?.tags, ['unused:first', 'unused:second']);
  assert.equal(
    result.requests.some((request) => request.startsWith('DELETE /images/unused%3A')),
    false
  );
});

async function updateHarness(cleanupFails: boolean) {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-update-cleanup-'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'lib'));
  await writeFile(
    path.join(root, 'scripts/update-run.sh'),
    await readFile(path.join(repoRoot, 'stackarr/scripts/update-run.sh'))
  );
  for (const name of ['naming.sh', 'downloads.sh', 'requests.sh']) {
    await writeFile(
      path.join(root, 'scripts', name),
      '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$STACKARR_TEST_ACTIONS"\n'
    );
    await chmod(path.join(root, 'scripts', name), 0o755);
  }
  await writeFile(
    path.join(root, 'lib/common.sh'),
    `print_header() { :; }
load_env() { :; }
database_mode_is_postgres() { return 1; }
write_compose_env_file() { :; }
wait_for_stackarr_storage() { :; }
ensure_docker_runtime() { :; }
compose_profile_args() { printf '%s\\n' --profile stackarr; }
stackarr_compose() {
  printf '%s\\n' "$*" >> "$STACKARR_TEST_ACTIONS"
  case "$*" in
    *'config --services') printf 'app\\nfirst\\n';;
    *'run --rm image-cleanup') printf 'Deleted image: sha256:abc123\\nReclaimed bytes: 1234567\\n'; return ${cleanupFails ? 1 : 0};;
  esac
  return 0
}
remove_database_init_sidecar() { :; }
remove_inactive_torrent_client_container() { :; }
warn() { printf '%s\\n' "$1"; }
ok() { printf '%s\\n' "$1"; }
fail() { printf '%s\\n' "$1" >&2; exit 1; }
`
  );
  const actions = path.join(root, 'actions');
  try {
    const result = await execFile('bash', [path.join(root, 'scripts/update-run.sh'), 'services'], {
      env: { ...process.env, STACKARR_TEST_ACTIONS: actions }
    }).then(
      (value) => ({ ...value, failed: false }),
      (error: Error & { stdout: string; stderr: string }) => ({
        stdout: error.stdout,
        stderr: error.stderr,
        failed: true
      })
    );
    return { ...result, actions: await readFile(actions, 'utf8') };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('cleanup runs after scoped recreation and before reconciliation; output reaches task stream', async () => {
  const result = await updateHarness(false);
  assert.equal(result.failed, false);
  assert.ok(result.actions.indexOf('up -d --no-deps first') < result.actions.indexOf('run --rm image-cleanup'));
  assert.ok(result.actions.indexOf('run --rm image-cleanup') < result.actions.indexOf('naming.sh apply'));
  assert.match(result.stdout, /Deleted image: sha256:abc123/);
  assert.match(result.stdout, /Reclaimed bytes: 1234567/);
  assert.doesNotMatch(result.actions, /volume prune|container prune/);
});

test('cleanup failure is reported after reconciliation, not as a successful update', async () => {
  const result = await updateHarness(true);
  assert.equal(result.failed, true);
  assert.match(result.stderr, /Managed services were updated, but unused Docker image cleanup failed/);
  assert.match(result.actions, /downloads.sh apply --wait/);
  assert.match(result.actions, /requests.sh apply --wait/);
});
