import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const bridge = fileURLToPath(new URL('../../../stackarr/scripts/backup-mount-bridge.sh', import.meta.url));
const runner = fileURLToPath(new URL('../../../stackarr/scripts/backup-run.sh', import.meta.url));
const root = '/Volumes/Fixture/Backups';

async function waitRequest(dir: string): Promise<string> {
  for (let n = 0; n < 100; n++) {
    const found = (await readdir(dir)).find((file) => file.endsWith('.request'));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('preflight did not publish a request');
}

async function runVerify(script: string, state: string, respond: (request: string) => Promise<void>) {
  const child = spawn('/bin/bash', [script, 'verify', state, root]);
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const request = await waitRequest(path.join(state, 'backup-mount-bridge'));
  await respond(request);
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  return { code, stderr };
}

test('external mount bridge accepts only fresh matching host mount-table replies', { timeout: 40000 }, async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'stackarr-mount-'));
  const state = path.join(fixture, 'state');
  const dir = path.join(state, 'backup-mount-bridge');
  const mock = path.join(fixture, 'bridge.sh');
  try {
    await mkdir(dir, { recursive: true });
    // Simulate the host platform and mount table, retaining real request-file timestamps.
    const source = await readFile(bridge, 'utf8');
    await writeFile(
      mock,
      source
        .replace('"$(uname -s)"', '"Darwin"')
        .replace('"$(/sbin/mount)"', '"${MOCK_MOUNT:-}"')
        .replace(
          'stat -f %m "$request"',
          process.platform === 'darwin' ? 'stat -f %m "$request"' : 'stat -c %Y "$request"'
        )
    );
    await chmod(mock, 0o700);
    const respond = (mount: string) => {
      execFileSync('/bin/bash', [mock, 'respond', state, root], { env: { ...process.env, MOCK_MOUNT: mount } });
    };
    const mounted = await runVerify(mock, state, async () => respond('/dev/disk7s1 on /Volumes/Fixture (apfs, local)'));
    assert.equal(mounted.code, 0, mounted.stderr);
    const absent = await runVerify(mock, state, async () =>
      respond('/dev/disk7s1 on /Volumes/FixtureOther (apfs, local)')
    );
    assert.notEqual(absent.code, 0);
    const noResponder = await runVerify(mock, state, async () => {});
    assert.notEqual(noResponder.code, 0);
    assert.match(noResponder.stderr, /missing, stale, or mismatched/);
    for (const variant of ['wrong-nonce', 'stale', 'wrong-root']) {
      const result = await runVerify(mock, state, async (request) => {
        const nonce = request.slice(0, -'.request'.length);
        const replyNonce = variant === 'wrong-nonce' ? 'wrongnonce' : nonce;
        const replyRoot = variant === 'wrong-root' ? '/Volumes/Other/Backups' : root;
        const issued = variant === 'stale' ? 1 : Math.floor(Date.now() / 1000);
        await writeFile(path.join(dir, `${nonce}.response`), `${replyNonce}\n${replyRoot}\nmounted\n${issued}\n`);
      });
      assert.notEqual(result.code, 0, variant);
    }
    const nonce = 'a'.repeat(32);
    await writeFile(
      path.join(dir, `${nonce}.request`),
      `${nonce}\n/Volumes/Other/Backups\n${Math.floor(Date.now() / 1000)}\n`
    );
    respond('/dev/disk7s1 on /Volumes/Fixture (apfs, local)');
    assert.deepEqual(
      (await readdir(dir)).filter((file) => file.endsWith('.response')),
      []
    );
    const backupSource = await readFile(runner, 'utf8');
    assert.ok(
      backupSource.indexOf('verify_external_backup_mount "$BACKUP_ROOT"') <
        backupSource.indexOf('task_ensure_dir "backup root"')
    );
    assert.match(backupSource, /backup-mount-bridge\.sh" verify "\$STATE_ROOT" "\$root"/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
