import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scriptsRoot = path.join(repoRoot, 'stackarr/scripts');

test('all repository-managed Stackarr LaunchAgent installers use the canonical app-data runtime', async () => {
  for (const filename of ['startup-install.sh', 'update-install.sh', 'backup-install.sh', 'portless.sh']) {
    const source = await readFile(path.join(scriptsRoot, filename), 'utf8');
    assert.match(source, /install_managed_host_runtime/, `${filename} must stage the managed host runtime`);
    assert.doesNotMatch(source, /STACKARR_BIN="\$\(find_stackarr_bin/, `${filename} must not select a checkout executable`);
    assert.match(source, /LAUNCH_APP_ROOT="\$\(default_app_root\)"/, `${filename} must use the canonical app-data working directory`);
  }
});

test('Doctor audits Portless and every com.stackarr LaunchAgent for non-app-data code paths', async () => {
  const source = await readFile(path.join(scriptsRoot, 'doctor.sh'), 'utf8');
  assert.match(source, /com\.stackarr\.portless\.plist/);
  assert.match(source, /glob\.glob\(os\.path\.join\(agent_dir, "com\.stackarr\.\*\.plist"\)\)/);
  assert.match(source, /All Stackarr launch agents use app-data runtime paths/);
});

test('Doctor skips host-only diagnostics inside the Docker controller', async () => {
  const source = await readFile(path.join(scriptsRoot, 'doctor.sh'), 'utf8');
  assert.match(source, /if stackarr_runtime_is_container; then\n\s+pass "Native Plex host process and API checks are not applicable inside Docker"/);
  assert.match(source, /pass "macOS launch agent checks are not applicable inside Docker"/);
  assert.match(source, /pass "Cloudflare connector checks are handled by the Stackarr host runtime"/);
  assert.match(source, /pass "Tailscale host checks are not applicable inside Docker"/);
});

test('cloudflared discovery cannot fall back to environment, PATH, or Homebrew', async () => {
  const source = await readFile(path.join(repoRoot, 'stackarr/lib/common.sh'), 'utf8');
  const match = source.match(/find_cloudflared_bin\(\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'find_cloudflared_bin must exist');
  const body = match[1];
  assert.match(body, /managed_cloudflared_bin/);
  assert.doesNotMatch(body, /CLOUDFLARED_BIN|command -v cloudflared|homebrew|usr\/local/);
});
