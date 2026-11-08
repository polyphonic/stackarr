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
import { applySafeFixAction, containerHealthFindings, healthComposeProject } from '../../core/src/actions/health';
import type { StackarrEnv } from '../../core/src/env';
import { getMcpToolCatalog } from '../../core/src/mcp/controlPlane';
import { type ServiceSummary, servicesFromEnv } from '../../core/src/services';

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

test('managed database and Redis are Docker-owned by default; external engines are not missing containers', () => {
  const overview = { dockerAvailable: true, containers: [] } as unknown as DockerContainerOverview;
  const infrastructure = (env: StackarrEnv) =>
    servicesFromEnv({ ENABLE_IMMICH: 'true', ...env }).filter(
      (service) => service.name === 'database' || service.name === 'redis'
    );
  const managed = infrastructure({} as StackarrEnv);
  assert.deepEqual(
    managed.map(({ name, mode, dockerService }) => [name, mode, dockerService]),
    [
      ['database', 'docker', 'database'],
      ['redis', 'docker', 'redis']
    ]
  );
  assert.deepEqual(
    containerHealthFindings(managed, overview).map(({ service }) => service),
    ['database', 'redis']
  );

  for (const deploymentMode of ['external', 'independent']) {
    const external = infrastructure({
      POSTGRES_DEPLOYMENT_MODE: deploymentMode,
      REDIS_DEPLOYMENT_MODE: deploymentMode
    } as StackarrEnv);
    assert.deepEqual(
      external.map(({ name, mode, dockerService }) => [name, mode, dockerService]),
      [
        ['database', 'native', undefined],
        ['redis', 'native', undefined]
      ]
    );
    assert.deepEqual(containerHealthFindings(external, overview), []);
  }
  const disabledRedis = infrastructure({
    ENABLE_IMMICH: 'false',
    REDIS_DEPLOYMENT_MODE: 'external'
  } as StackarrEnv).find((service) => service.name === 'redis');
  assert.equal(disabledRedis?.mode, 'disabled');
});

test('Recyclarr and report use the authoritative Compose project, not a same-named foreign container', () => {
  const env = { STACKARR_COMPOSE_PROJECT_NAME: 'installed', COMPOSE_PROJECT_NAME: 'legacy' } as StackarrEnv;
  assert.equal(healthComposeProject(env), 'installed');
  assert.equal(healthComposeProject({ COMPOSE_PROJECT_NAME: 'legacy' } as StackarrEnv), 'legacy');
  const overview = {
    dockerAvailable: true,
    containers: [
      {
        composeProject: 'foreign',
        composeService: 'recyclarr',
        running: true,
        status: 'Up (healthy)',
        restartPolicy: 'unless-stopped'
      }
    ]
  } as DockerContainerOverview;
  assert.deepEqual(
    containerHealthFindings([enabled('recyclarr')], overview, healthComposeProject(env)).map(({ service, message }) => [
      service,
      message
    ]),
    [['recyclarr', 'Enabled Docker container is absent.']]
  );
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
