import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const pluginsScript = path.join(repoRoot, 'stackarr/scripts/plugins.sh');

test('plugin exports use the canonical app-data runtime instead of the checkout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-plugin-runtime-test-'));
  const home = path.join(root, 'home');
  const externalAppRoot = path.join(root, 'external-app-root');
  const destination = path.join(root, 'plugin');
  const managedRoot = path.join(home, 'Library/Application Support/Stackarr/state/host-runtime');
  const managedBin = path.join(managedRoot, 'bin/stackarr');

  try {
    const { stdout, stderr } = await execFile(
      'bash',
      [pluginsScript, 'export', 'hermes', '--target', destination, '--no-configure'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: home,
          APP_ROOT: externalAppRoot,
          STATE_ROOT: path.join(externalAppRoot, 'state'),
          CONFIG_ROOT: path.join(externalAppRoot, 'config'),
          LOG_ROOT: path.join(externalAppRoot, 'logs'),
          STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db'),
          STACKARR_RUNTIME: 'native'
        }
      }
    );

    const output = `${stdout}\n${stderr}`;
    assert.match(output, new RegExp(managedBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(output, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await access(managedBin);
    await access(path.join(managedRoot, 'packages/agent-plugins/hermes/stackarr'));
    assert.match(await readFile(path.join(destination, 'plugin.yaml'), 'utf8'), /stackarr/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
