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
            updateStackConfigAction,
            updateTelemetryConfigAction
          } = await import('./packages/core/src/index.ts');

          updateStackConfigAction({
            values: {
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
            }
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
          const server = http.createServer((request, response) => {
            let body = '';
            request.setEncoding('utf8');
            request.on('data', (chunk) => {
              body += chunk;
            });
            request.on('end', () => {
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
            updateStackConfigAction,
            updateTelemetryConfigAction
          } = await import('./packages/core/src/index.ts');

          updateStackConfigAction({
            values: {
              STACKARR_TELEMETRY_FEATURE_ENABLED: 'true',
              STACKARR_TELEMETRY_INGEST_KEY: 'test-ingest-key',
              STACKARR_DATABASE_MODE: 'app-default'
            }
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

          await new Promise((resolve) => server.close(resolve));
          console.log(JSON.stringify({ configured, first, second, status, received }));
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
    assert.equal(result.received.length, 1);
    assert.equal(result.received[0].authorization, 'Bearer test-ingest-key');
    assert.equal(result.received[0].schema, '1');
    assert.equal(result.received[0].body.eventName, 'stackarr.heartbeat');
    assert.equal(result.received[0].body.install.channel, 'test');
    assert.equal(result.received[0].body.setup.databaseMode, 'app-default');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('telemetry is hidden behind a feature gate by default', async () => {
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
          const rejected = updateTelemetryConfigAction({
            enabled: true,
            endpoint: 'https://telemetry.example.com/v1/events',
            confirmTelemetry: true
          });
          const heartbeat = await maybeSendTelemetryHeartbeatAction();

          console.log(JSON.stringify({ status, rejected, heartbeat }));
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
    assert.equal(result.status.featureEnabled, false);
    assert.equal(result.rejected.accepted, false);
    assert.equal(result.rejected.error, 'Telemetry is feature-gated in this build.');
    assert.equal(result.heartbeat.skipped, true);
    assert.equal(result.heartbeat.reason, 'feature-gated');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
