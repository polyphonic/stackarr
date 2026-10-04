import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { DockerContainerOverview } from '../../core/src/actions/containers';
import { applySafeFixAction, containerHealthFindings } from '../../core/src/actions/health';
import { getMcpToolCatalog } from '../../core/src/mcp/controlPlane';
import type { ServiceSummary } from '../../core/src/services';

test('health report is available in the default MCP profile without service gating', () => {
  assert.ok(
    getMcpToolCatalog({ profile: 'manage', enabledServices: [] }).some(
      (tool) => tool.name === 'stackarr_get_health_report'
    )
  );
});

const enabled = (name: string): ServiceSummary => ({
  name,
  displayName: name,
  description: '',
  category: 'support',
  kind: 'container',
  mode: 'docker',
  status: 'configured',
  experience: 'app',
  dockerService: name
});

test('enabled absent and unhealthy containers are findings, never unrelated compose projects', () => {
  const overview = {
    dockerAvailable: true,
    containers: [
      {
        composeProject: 'other',
        composeService: 'frigate',
        status: 'Up (healthy)',
        running: true,
        restartPolicy: 'unless-stopped'
      },
      {
        composeProject: 'stackarr',
        composeService: 'tdarr',
        status: 'Up (unhealthy)',
        running: true,
        restartPolicy: 'no'
      }
    ]
  } as DockerContainerOverview;
  const findings = containerHealthFindings(['homeassistant', 'frigate', 'mosquitto', 'tdarr'].map(enabled), overview);
  for (const service of ['homeassistant', 'frigate', 'mosquitto']) {
    assert.ok(findings.some((finding) => finding.service === service && finding.message.includes('absent')));
  }
  assert.ok(findings.some((finding) => finding.service === 'tdarr' && finding.message.includes('unhealthy')));
  assert.ok(findings.some((finding) => finding.service === 'tdarr' && finding.message.includes('restart policy')));
  assert.equal(applySafeFixAction({ fixId: 'refresh-status-cache' }).applied, false);
  assert.equal(applySafeFixAction({ fixId: 'none' }).applied, false);
});

test('HTTP auth challenge is reachable but never fully authenticated healthy, and 502 is unavailable', async () => {
  const server = createServer((request, response) => {
    response.statusCode = request.url === '/api/health' ? 502 : 401;
    response.end('secret-token=super-secret-key');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-reliability-'));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const script = `
      const { writeEnvConfig } = await import('./packages/core/src/env.ts');
      const { getAppHealthSummaryAction } = await import('./packages/core/src/actions/health.ts');
      writeEnvConfig({ ENABLE_HOMEASSISTANT: 'true', ENABLE_FRIGATE: 'true', ENABLE_CLEANUPARR: 'true',
        HOMEASSISTANT_URL: ${JSON.stringify(url)}, FRIGATE_URL: ${JSON.stringify(url)}, CLEANUPARR_URL: ${JSON.stringify(url)} });
      console.log(JSON.stringify(await getAppHealthSummaryAction()));
    `;
    const { stdout } = await promisify(execFileCallback)(
      process.execPath,
      [
        '--import',
        path.join(repo, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs'),
        '--input-type=module',
        '-e',
        script
      ],
      {
        cwd: repo,
        env: { ...process.env, STACKARR_DATABASE_URL: '', STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db') }
      }
    );
    const summary = JSON.parse(stdout);
    for (const name of ['homeassistant', 'frigate']) {
      const check = summary.checks.find((item: { service: string }) => item.service === name);
      assert.equal(check?.status, 'unsupported');
      assert.equal(check?.availability, 'reachable');
      assert.equal(check?.authentication, 'notConfigured');
    }
    const cleanuparr = summary.checks.find((item: { service: string }) => item.service === 'cleanuparr');
    assert.equal(cleanuparr?.status, 'unavailable');
    assert.doesNotMatch(stdout, /super-secret-key/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
