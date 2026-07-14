import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('telemetry rate-limit identifiers are opaque and policy scoped', async () => {
  const { telemetryRateLimitIdentifier } = await import('../../../apps/docs/src/app/api/telemetry/rate-limit.ts');
  const key = 'collector-signing-key-with-at-least-32-characters';
  const address = '203.0.113.42';
  const registration = telemetryRateLimitIdentifier('registration', address, key);
  const ingest = telemetryRateLimitIdentifier('ingest', address, key);

  assert.match(registration, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(registration, /203\.0\.113\.42/);
  assert.notEqual(registration, ingest);
  assert.notEqual(registration, telemetryRateLimitIdentifier('registration', address, `${key}-rotated`));
});

test('telemetry collector fails closed without Upstash and accepts a complete server configuration', async () => {
  const evaluateConfig = async (upstashConfigured: boolean) => {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { getTelemetryCollectorConfig } = await import('./apps/docs/src/env/server.ts');
          try {
            const config = getTelemetryCollectorConfig();
            console.log(JSON.stringify({
              enabled: config.enabled,
              hasRateLimit: Boolean(config.enabled && config.rateLimit.url && config.rateLimit.token),
              maxPayloadBytes: config.enabled ? config.maxPayloadBytes : 0
            }));
          } catch (error) {
            console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_TELEMETRY_COLLECTOR_ENABLED: 'true',
          STACKARR_TELEMETRY_INGEST_KEY: 'collector-signing-key-with-at-least-32-characters',
          DATABASE_URL: 'postgresql://stackarr:secret@example.test/stackarr?sslmode=require',
          UPSTASH_REDIS_REST_URL: upstashConfigured ? 'https://example.upstash.io' : '',
          UPSTASH_REDIS_REST_TOKEN: upstashConfigured ? 'upstash-rest-token' : ''
        }
      }
    );

    return JSON.parse(stdout);
  };

  const missing = await evaluateConfig(false);
  const configured = await evaluateConfig(true);

  assert.match(missing.error, /UPSTASH_REDIS_REST_URL/);
  assert.deepEqual(configured, { enabled: true, hasRateLimit: true, maxPayloadBytes: 16_384 });
});

test('collector tokens are scoped to one installation and expire', async () => {
  const { issueTelemetryClientToken, verifyTelemetryClientToken } = await import(
    '../../../apps/docs/src/app/api/telemetry/auth.ts'
  );
  const signingKey = 'collector-signing-key-with-at-least-32-characters';
  const firstInstall = '11111111-1111-4111-8111-111111111111';
  const secondInstall = '22222222-2222-4222-8222-222222222222';
  const now = Date.now();
  const { token } = issueTelemetryClientToken(firstInstall, signingKey, now);

  assert.equal(verifyTelemetryClientToken(token, signingKey, firstInstall, now), true);
  assert.equal(verifyTelemetryClientToken(token, signingKey, secondInstall, now), false);
  assert.equal(verifyTelemetryClientToken(token, `${signingKey}-wrong`, firstInstall, now), false);
  assert.equal(verifyTelemetryClientToken(token, signingKey, firstInstall, now + 181 * 24 * 60 * 60 * 1000), false);
});

test('packaged telemetry CLI honors a locally encoded collector endpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-telemetry-cli-test-'));
  const endpoint = 'https://preview.example.test/api/telemetry/events';

  try {
    const { stdout } = await execFile(process.execPath, ['stackarr/scripts/telemetry.cjs', 'status'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db'),
        STACKARR_TELEMETRY_ENDPOINT: endpoint
      }
    });

    const result = JSON.parse(stdout);
    assert.equal(result.enabled, false);
    assert.equal(result.endpoint, endpoint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('telemetry reports the running build channel instead of a legacy stable default', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-telemetry-channel-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const {
            getTelemetryStatusAction,
            updateTelemetryConfigAction,
            writeEnvConfig
          } = await import('./packages/core/src/index.ts');

          writeEnvConfig({ STACKARR_TELEMETRY_CHANNEL: 'stable' });
          updateTelemetryConfigAction({ channel: 'stable' });

          const status = getTelemetryStatusAction();
          console.log(JSON.stringify({ status }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_CHANNEL: 'alpha',
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db')
        }
      }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.status.channel, 'alpha');
    assert.equal(result.status.payloadPreview.install.channel, 'alpha');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('telemetry preview is opt-in and excludes host paths and secrets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-telemetry-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const {
            getTelemetryStatusAction,
            previewTelemetryPayloadAction,
            updateTelemetryConfigAction,
            writeEnvConfig
          } = await import('./packages/core/src/index.ts');

          writeEnvConfig({
            STACKARR_TELEMETRY_FEATURE_ENABLED: 'true',
            MEDIA_ROOT: '/srv/private-media',
            BACKUP_ROOT: '/mnt/private-backup/stackarr',
            PASSWORD: 'super-secret-password',
            PLEX_TOKEN: 'plex-token-value',
            PLEX_INSTALL_MODE: 'native',
            JELLYFIN_INSTALL_MODE: 'disabled',
            STACKARR_DATABASE_MODE: 'postgres',
            ENABLE_BACKUP: 'true',
            BACKUP_RETENTION_COUNT: '52'
          });

          const before = getTelemetryStatusAction();
          const rejected = updateTelemetryConfigAction({
            enabled: true,
            endpoint: 'https://telemetry.example.com/v1/events'
          });
          const accepted = updateTelemetryConfigAction({
            enabled: true,
            endpoint: 'https://telemetry.example.com/v1/events',
            channel: 'alpha',
            confirmTelemetry: true
          });
          const preview = previewTelemetryPayloadAction();

          console.log(JSON.stringify({ before, rejected, accepted, preview }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db')
        }
      }
    );

    const result = JSON.parse(stdout);
    const payload = result.preview.payload;
    const serialized = JSON.stringify(payload);

    assert.equal(result.before.enabled, false);
    assert.equal(result.rejected.accepted, false);
    assert.equal(result.rejected.confirmationRequired, true);
    assert.equal(result.accepted.accepted, true);
    assert.equal(result.accepted.telemetry.enabled, true);
    assert.equal(result.accepted.telemetry.installId, 'configured');
    assert.equal(payload.setup.databaseMode, 'postgres');
    assert.equal(payload.services.mediaServers.plex, 'native');
    assert.equal(payload.backups.retentionBucket, '13-52');
    assert.equal(payload.schemaVersion, 2);
    assert.ok(Array.isArray(payload.health.issueCodes));
    assert.equal(typeof payload.health.recentTaskFailures, 'string');
    assert.match(payload.install.id, /^[0-9a-f-]{36}$/);
    assert.doesNotMatch(serialized, /private-media|private-backup|super-secret-password|plex-token-value/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('telemetry heartbeat sends to configured collector with auth and throttles repeats', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-telemetry-heartbeat-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          import http from 'node:http';

          const received = [];
          const registrations = [];
          const server = http.createServer((request, response) => {
            let body = '';
            request.setEncoding('utf8');
            request.on('data', (chunk) => {
              body += chunk;
            });
            request.on('end', () => {
              if (request.url === '/register') {
                registrations.push(JSON.parse(body));
                response.writeHead(201, { 'content-type': 'application/json' });
                response.end(JSON.stringify({
                  accepted: true,
                  token: 'scoped-client-token-for-telemetry-test-1234567890'
                }));
                return;
              }
              received.push({
                authorization: request.headers.authorization,
                schema: request.headers['x-stackarr-telemetry-schema'],
                body: JSON.parse(body)
              });
              response.writeHead(202, { 'content-type': 'application/json' });
              response.end(JSON.stringify({ accepted: true }));
            });
          });

          await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
          const address = server.address();
          const endpoint = \`http://127.0.0.1:\${address.port}/events\`;

          const {
            getTelemetryStatusAction,
            maybeSendTelemetryHeartbeatAction,
            readEnv,
            updateTelemetryConfigAction,
            writeEnvConfig
          } = await import('./packages/core/src/index.ts');

          writeEnvConfig({
            STACKARR_TELEMETRY_FEATURE_ENABLED: 'true',
            STACKARR_DATABASE_MODE: 'app-default'
          });

          const configured = updateTelemetryConfigAction({
            enabled: true,
            endpoint,
            channel: 'test',
            confirmTelemetry: true
          });
          const first = await maybeSendTelemetryHeartbeatAction();
          const second = await maybeSendTelemetryHeartbeatAction();
          const status = getTelemetryStatusAction();
          const clientTokenStored = Boolean(readEnv().STACKARR_TELEMETRY_CLIENT_TOKEN);

          await new Promise((resolve) => server.close(resolve));
          console.log(JSON.stringify({ configured, first, second, status, received, registrations, clientTokenStored }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db')
        }
      }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.configured.accepted, true);
    assert.equal(result.first.accepted, true);
    assert.equal(result.first.status, 202);
    assert.equal(result.second.skipped, true);
    assert.equal(result.second.reason, 'recently-sent');
    assert.equal(result.status.lastSentAt, result.first.sentAt);
    assert.equal(result.registrations.length, 1);
    assert.equal(result.registrations[0].schemaVersion, 2);
    assert.equal(result.registrations[0].installId, result.received[0].body.install.id);
    assert.equal(result.clientTokenStored, true);
    assert.equal(result.received.length, 1);
    assert.equal(result.received[0].authorization, 'Bearer scoped-client-token-for-telemetry-test-1234567890');
    assert.equal(result.received[0].schema, '2');
    assert.equal(result.received[0].body.eventName, 'stackarr.heartbeat');
    assert.equal(result.received[0].body.install.channel, 'test');
    assert.equal(result.received[0].body.setup.databaseMode, 'app-default');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('telemetry is available but remains opt-in by default', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-telemetry-gate-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const {
            getTelemetryStatusAction,
            maybeSendTelemetryHeartbeatAction,
            updateTelemetryConfigAction
          } = await import('./packages/core/src/index.ts');

          const status = getTelemetryStatusAction();
          const confirmationRequired = updateTelemetryConfigAction({
            enabled: true,
            endpoint: 'https://telemetry.example.com/v1/events'
          });
          const heartbeat = await maybeSendTelemetryHeartbeatAction();

          console.log(JSON.stringify({ status, confirmationRequired, heartbeat }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db')
        }
      }
    );

    const result = JSON.parse(stdout);
    assert.equal(result.status.featureEnabled, true);
    assert.equal(result.status.enabled, false);
    assert.equal(result.confirmationRequired.accepted, false);
    assert.equal(result.confirmationRequired.confirmationRequired, true);
    assert.equal(result.heartbeat.skipped, true);
    assert.equal(result.heartbeat.reason, 'telemetry-disabled');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
