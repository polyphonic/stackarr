import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cloudflareScript = path.join(repoRoot, 'stackarr/scripts/cloudflare.sh');

async function writeExecutable(file: string, content: string) {
  await writeFile(file, content);
  await chmod(file, 0o755);
}

test('Cloudflare start uses only the Stackarr-managed app-data binary', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-cloudflared-runtime-test-'));
  const home = path.join(root, 'home');
  const appRoot = path.join(root, 'app');
  const stateRoot = path.join(appRoot, 'state');
  const binDir = path.join(root, 'test-bin');
  const managedCloudflared = path.join(home, 'Library/Application Support/Stackarr/bin/cloudflared');
  const launchctlLog = path.join(root, 'launchctl.log');

  try {
    await mkdir(path.dirname(managedCloudflared), { recursive: true });
    await mkdir(stateRoot, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(path.join(stateRoot, 'cloudflared-token'), 'test-token\n', { mode: 0o600 });
    await writeExecutable(managedCloudflared, '#!/bin/sh\nexit 0\n');
    await writeExecutable(
      path.join(binDir, 'launchctl'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$STACKARR_TEST_LAUNCHCTL_LOG"
exit 0
`
    );
    await writeExecutable(
      path.join(binDir, 'curl'),
      `#!/bin/sh
case "$*" in
  *127.0.0.1:42183/ready*) exit 0 ;;
  *) exit 1 ;;
esac
`
    );

    await execFile('bash', [cloudflareScript, 'start'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:/usr/bin:/bin`,
        HOME: home,
        APP_ROOT: appRoot,
        CONFIG_ROOT: path.join(appRoot, 'config'),
        STATE_ROOT: stateRoot,
        LOG_ROOT: path.join(appRoot, 'logs'),
        CLOUDFLARED_BIN: '/opt/homebrew/bin/cloudflared',
        CLOUDFLARED_TOKEN_FILE: path.join(stateRoot, 'cloudflared-token'),
        CLOUDFLARED_METRICS_PORT: '42183',
        STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db'),
        STACKARR_RUNTIME: 'native',
        STACKARR_TEST_LAUNCHCTL_LOG: launchctlLog
      }
    });

    const plist = await readFile(path.join(home, 'Library/LaunchAgents/com.stackarr.cloudflared.plist'), 'utf8');
    assert.match(plist, new RegExp(managedCloudflared.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(plist, /Developer\/Stackarr|\/Volumes\/|homebrew/);
    assert.match(await readFile(launchctlLog, 'utf8'), /bootstrap gui\/\d+/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('managed cloudflared install verifies the official release digest before using the binary', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-cloudflared-download-test-'));
  const home = path.join(root, 'home');
  const appRoot = path.join(root, 'app');
  const payloadDir = path.join(root, 'payload');
  const releaseFile = path.join(root, 'release.json');
  const assetName =
    process.platform === 'darwin'
      ? `cloudflared-darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}.tgz`
      : `cloudflared-linux-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
  const assetFile = path.join(root, assetName);

  try {
    await mkdir(home, { recursive: true });
    await mkdir(payloadDir, { recursive: true });
    const payload = path.join(payloadDir, 'cloudflared');
    await writeExecutable(payload, '#!/bin/sh\necho "cloudflared version test"\n');
    if (assetName.endsWith('.tgz')) {
      await execFile('tar', ['-czf', assetFile, '-C', payloadDir, 'cloudflared']);
    } else {
      await writeFile(assetFile, await readFile(payload));
    }
    const digest = createHash('sha256').update(await readFile(assetFile)).digest('hex');
    await writeFile(
      releaseFile,
      JSON.stringify({
        assets: [
          {
            name: assetName,
            digest: `sha256:${digest}`,
            browser_download_url: `file://${assetFile}`
          }
        ]
      })
    );

    await execFile('bash', [cloudflareScript, 'binary', 'install'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        APP_ROOT: appRoot,
        CONFIG_ROOT: path.join(appRoot, 'config'),
        STATE_ROOT: path.join(appRoot, 'state'),
        LOG_ROOT: path.join(appRoot, 'logs'),
        CLOUDFLARED_RELEASE_API: `file://${releaseFile}`,
        STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db'),
        STACKARR_RUNTIME: 'native'
      }
    });

    const installed = await readFile(path.join(home, 'Library/Application Support/Stackarr/bin/cloudflared'), 'utf8');
    assert.match(installed, /cloudflared version test/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
