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

test('API key auth fails closed for command-style requests', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-api-auth-test-'));

  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { requireApiKey } = await import('./apps/frontend/src/lib/api.ts');
          const { PUT: putStackarrConfig } = await import('./apps/frontend/src/app/api/v1/config/stackarr/route.ts');
          const { GET: getStackarrConfig } = await import('./apps/frontend/src/app/api/v1/config/stackarr/route.ts');
          const { POST: login } = await import('./apps/frontend/src/app/api/v1/auth/login/route.ts');
          const { GET: getBackup } = await import('./apps/frontend/src/app/api/v1/backup/route.ts');
          const { GET: getContainers } = await import('./apps/frontend/src/app/api/v1/containers/route.ts');
          const { GET: getNotification } = await import('./apps/frontend/src/app/api/v1/notification/route.ts');
          const { GET: getTask } = await import('./apps/frontend/src/app/api/v1/task/route.ts');
          const { GET: getTelemetry } = await import('./apps/frontend/src/app/api/v1/telemetry/route.ts');
          const { GET: getAgentActivity } = await import('./apps/frontend/src/app/api/v1/agent/activity/route.ts');
          const { GET: getAgentActivityDetail } = await import('./apps/frontend/src/app/api/v1/agent/activity/[id]/route.ts');
          const { GET: getAgentTools } = await import('./apps/frontend/src/app/api/v1/agent/tools/route.ts');
          const { GET: getAgentConnections } = await import('./apps/frontend/src/app/api/v1/agent/connections/route.ts');
          const { GET: getStreamrip } = await import('./apps/frontend/src/app/api/v1/downloaders/streamrip/route.ts');
          const { GET: getLidarrStreamrip } = await import('./apps/frontend/src/app/api/v1/downloaders/streamrip/lidarr/route.ts');
          const { GET: getServiceConfig } = await import('./apps/frontend/src/app/api/v1/services/config/[service]/route.ts');
          const { GET: getMetrics } = await import('./apps/frontend/src/app/api/v1/system/metrics/route.ts');
          const { GET: getSystemStatus } = await import('./apps/frontend/src/app/api/v1/system/status/route.ts');
          const { readEnv, updateServiceConfigAction, updateStackConfigAction } = await import('./packages/core/src/index.ts');
          const { NextRequest } = await import('./apps/frontend/node_modules/next/server.js');
          const crypto = await import('node:crypto');

          function forgeBootstrapSession(username) {
            const payload = Buffer.from(JSON.stringify({
              username,
              expiresAt: Date.now() + 60 * 60 * 1000
            })).toString('base64url');
            const signature = crypto
              .createHmac('sha256', 'stackarr-session-bootstrap')
              .update(payload)
              .digest('base64url');

            return 'stackarr_session=' + payload + '.' + signature;
          }

          const commandUrl = 'http://127.0.0.1:7777/api/v1/command';
          const missingKey = requireApiKey(new NextRequest(commandUrl, { method: 'POST' }));
          const forgedBootstrapSession = requireApiKey(
            new NextRequest(commandUrl, {
              method: 'POST',
              headers: { cookie: forgeBootstrapSession('admin') }
            })
          );
          const agentActivityWithoutKey = await getAgentActivity(
            new NextRequest('http://127.0.0.1:7777/api/v1/agent/activity')
          );
          const agentActivityDetailWithoutKey = await getAgentActivityDetail(
            new NextRequest('http://127.0.0.1:7777/api/v1/agent/activity/missing'),
            { params: Promise.resolve({ id: 'missing' }) }
          );
          const bootstrapResponse = await putStackarrConfig(
            new NextRequest('http://127.0.0.1:7777/api/v1/config/stackarr', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                config: {
                  STACKARR_WEB_PORT: '7777',
                  USERNAME: 'admin',
                  USER_EMAIL: 'admin@example.com',
                  PASSWORD: 'secret123'
                }
              })
            })
          );
          const bootstrapBody = await bootstrapResponse.json();
          const badLogin = await login(
            new NextRequest('http://127.0.0.1:7777/api/v1/auth/login', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ username: 'admin', password: 'wrong' })
            })
          );
          const loginResponse = await login(
            new NextRequest('https://app.stack/api/v1/auth/login', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ username: 'admin@example.com', password: 'secret123' })
            })
          );
          const sessionCookie = loginResponse.headers.get('set-cookie') ?? '';

          const noHeader = requireApiKey(new NextRequest(commandUrl, { method: 'POST' }));
          const sameOriginBrowser = requireApiKey(
            new NextRequest(commandUrl, {
              method: 'POST',
              headers: {
                origin: 'http://127.0.0.1:7777',
                'sec-fetch-site': 'same-origin'
              }
            })
          );
          const validSession = requireApiKey(
            new NextRequest(commandUrl, {
              method: 'POST',
              headers: { cookie: sessionCookie }
            })
          );
          const validHeader = requireApiKey(
            new NextRequest(commandUrl, {
              method: 'POST',
              headers: { 'x-api-key': bootstrapBody.apiKey }
            })
          );
          const protectedReadStatuses = Object.fromEntries(
            await Promise.all(
              [
                ['backup', getBackup(new NextRequest('http://127.0.0.1:7777/api/v1/backup'))],
                ['containers', getContainers(new NextRequest('http://127.0.0.1:7777/api/v1/containers'))],
                ['notification', getNotification(new NextRequest('http://127.0.0.1:7777/api/v1/notification'))],
                ['task', getTask(new NextRequest('http://127.0.0.1:7777/api/v1/task'))],
                ['telemetry', getTelemetry(new NextRequest('http://127.0.0.1:7777/api/v1/telemetry'))],
                ['agentTools', getAgentTools(new NextRequest('http://127.0.0.1:7777/api/v1/agent/tools'))],
                [
                  'agentConnections',
                  getAgentConnections(new NextRequest('http://127.0.0.1:7777/api/v1/agent/connections'))
                ],
                ['streamrip', getStreamrip(new NextRequest('http://127.0.0.1:7777/api/v1/downloaders/streamrip'))],
                [
                  'lidarrStreamrip',
                  getLidarrStreamrip(new NextRequest('http://127.0.0.1:7777/api/v1/downloaders/streamrip/lidarr'))
                ],
                [
                  'serviceConfig',
                  getServiceConfig(new NextRequest('http://127.0.0.1:7777/api/v1/services/config/radarr'), {
                    params: Promise.resolve({ service: 'radarr' })
                  })
                ],
                ['metrics', getMetrics(new NextRequest('http://127.0.0.1:7777/api/v1/system/metrics'))],
                ['systemStatus', getSystemStatus(new NextRequest('http://127.0.0.1:7777/api/v1/system/status'))],
                ['stackarrConfig', getStackarrConfig(new NextRequest('http://127.0.0.1:7777/api/v1/config/stackarr'))]
              ].map(async ([name, response]) => [name, (await response).status])
            )
          );
          const agentActivityWithHeader = await getAgentActivity(
            new NextRequest('http://127.0.0.1:7777/api/v1/agent/activity', {
              headers: { 'x-api-key': bootstrapBody.apiKey }
            })
          );
          const agentActivityDetailWithHeader = await getAgentActivityDetail(
            new NextRequest('http://127.0.0.1:7777/api/v1/agent/activity/missing', {
              headers: { 'x-api-key': bootstrapBody.apiKey }
            }),
            { params: Promise.resolve({ id: 'missing' }) }
          );
          const protectedStackConfigChange = updateStackConfigAction({
            values: { PASSWORD: 'attacker-password', STACKARR_API_KEY: 'attacker-api-key' }
          });
          const allowedStackConfigChange = updateStackConfigAction({ values: { TIMEZONE: 'UTC' } });
          const protectedServiceConfigChange = updateServiceConfigAction({
            service: 'stackarr',
            values: { stackarrApiKey: 'attacker-api-key' }
          });
          const protectedServiceConfigChangeWrongPassword = updateServiceConfigAction({
            service: 'stackarr',
            values: { stackarrApiKey: 'attacker-api-key' },
            currentPassword: 'wrong-password'
          });
          const allowedServiceSecretChange = updateServiceConfigAction({
            service: 'prowlarr',
            values: { prowlarrApiKey: 'prowlarr-service-secret' },
            currentPassword: 'secret123'
          });
          const envAfterStackConfigActions = readEnv();
          const identityWithoutPassword = await putStackarrConfig(
            new NextRequest('http://127.0.0.1:7777/api/v1/config/stackarr', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', 'x-api-key': bootstrapBody.apiKey },
              body: JSON.stringify({ config: { USERNAME: 'new-admin' } })
            })
          );
          const identityWithPassword = await putStackarrConfig(
            new NextRequest('http://127.0.0.1:7777/api/v1/config/stackarr', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: sessionCookie },
              body: JSON.stringify({ config: { USERNAME: 'new-admin' }, currentPassword: 'secret123' })
            })
          );
          const identitySessionCookie = identityWithPassword.headers.get('set-cookie') ?? '';
          const originalSessionAfterUsernameChange = requireApiKey(
            new NextRequest(commandUrl, { method: 'POST', headers: { cookie: sessionCookie } })
          );
          const renewedSessionAfterUsernameChange = requireApiKey(
            new NextRequest(commandUrl, { method: 'POST', headers: { cookie: identitySessionCookie } })
          );
          const passwordChange = await putStackarrConfig(
            new NextRequest('http://127.0.0.1:7777/api/v1/config/stackarr', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: identitySessionCookie },
              body: JSON.stringify({ config: { PASSWORD: 'secret456' }, currentPassword: 'secret123' })
            })
          );
          const passwordSessionCookie = passwordChange.headers.get('set-cookie') ?? '';
          const oldSessionAfterPasswordChange = requireApiKey(
            new NextRequest(commandUrl, { method: 'POST', headers: { cookie: identitySessionCookie } })
          );
          const renewedSessionAfterPasswordChange = requireApiKey(
            new NextRequest(commandUrl, { method: 'POST', headers: { cookie: passwordSessionCookie } })
          );
          const apiKeyChange = await putStackarrConfig(
            new NextRequest('http://127.0.0.1:7777/api/v1/config/stackarr', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: passwordSessionCookie },
              body: JSON.stringify({ config: { STACKARR_API_KEY: 'rotated-stackarr-api-key' }, currentPassword: 'secret456' })
            })
          );
          const sessionAfterApiKeyChange = requireApiKey(
            new NextRequest(commandUrl, { method: 'POST', headers: { cookie: passwordSessionCookie } })
          );
          const oldApiKeyAfterRotation = requireApiKey(
            new NextRequest(commandUrl, { method: 'POST', headers: { 'x-api-key': bootstrapBody.apiKey } })
          );
          const newApiKeyAfterRotation = requireApiKey(
            new NextRequest(commandUrl, { method: 'POST', headers: { 'x-api-key': 'rotated-stackarr-api-key' } })
          );
          const rateLimitStatuses = [];
          for (let attempt = 0; attempt < 6; attempt += 1) {
            const response = await login(
              new NextRequest('http://127.0.0.1:7777/api/v1/auth/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password: 'wrong' })
              })
            );
            rateLimitStatuses.push(response.status);
          }

          console.log(JSON.stringify({
            missingKey: missingKey?.status,
            forgedBootstrapSession: forgedBootstrapSession?.status,
            agentActivityWithoutKey: agentActivityWithoutKey.status,
            agentActivityDetailWithoutKey: agentActivityDetailWithoutKey.status,
            bootstrapStatus: bootstrapResponse.status,
            generatedKey: typeof bootstrapBody.apiKey === 'string' && bootstrapBody.apiKey.length >= 32,
            badLogin: badLogin.status,
            loginStatus: loginResponse.status,
            sessionCookie: sessionCookie.includes('stackarr_session='),
            noHeader: noHeader?.status,
            sameOriginBrowser: sameOriginBrowser?.status,
            validSession: validSession === null,
            validHeader: validHeader === null,
            protectedReadStatuses,
            agentActivityWithHeader: agentActivityWithHeader.status,
            agentActivityDetailWithHeader: agentActivityDetailWithHeader.status,
            protectedStackConfigChangeAccepted: protectedStackConfigChange.accepted,
            allowedStackConfigChangeAccepted: allowedStackConfigChange.accepted,
            protectedServiceConfigChangeAccepted: protectedServiceConfigChange.accepted,
            protectedServiceConfigChangeWrongPasswordAccepted: protectedServiceConfigChangeWrongPassword.accepted,
            allowedServiceSecretChangeAccepted: allowedServiceSecretChange.accepted,
            passwordAfterProtectedStackConfigChange: envAfterStackConfigActions.PASSWORD,
            apiKeyPreservedAfterProtectedStackConfigChange:
              envAfterStackConfigActions.STACKARR_API_KEY === bootstrapBody.apiKey,
            prowlarrApiKeyAfterServiceSecretChange: envAfterStackConfigActions.PROWLARR_API_KEY,
            timezoneAfterAllowedStackConfigChange: envAfterStackConfigActions.TIMEZONE,
            identityWithoutPassword: identityWithoutPassword.status,
            identityWithPassword: identityWithPassword.status,
            identitySessionCookie: identitySessionCookie.includes('stackarr_session='),
            originalSessionAfterUsernameChange: originalSessionAfterUsernameChange === null,
            renewedSessionAfterUsernameChange: renewedSessionAfterUsernameChange === null,
            passwordChange: passwordChange.status,
            passwordSessionCookie: passwordSessionCookie.includes('stackarr_session='),
            oldSessionAfterPasswordChange: oldSessionAfterPasswordChange?.status,
            renewedSessionAfterPasswordChange: renewedSessionAfterPasswordChange === null,
            apiKeyChange: apiKeyChange.status,
            sessionAfterApiKeyChange: sessionAfterApiKeyChange === null,
            oldApiKeyAfterRotation: oldApiKeyAfterRotation?.status,
            newApiKeyAfterRotation: newApiKeyAfterRotation === null,
            rateLimitStatuses
          }));
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

    assert.equal(result.missingKey, 503);
    assert.equal(result.forgedBootstrapSession, 503);
    assert.equal(result.agentActivityWithoutKey, 503);
    assert.equal(result.agentActivityDetailWithoutKey, 503);
    assert.equal(result.bootstrapStatus, 200);
    assert.equal(result.generatedKey, true);
    assert.equal(result.badLogin, 401);
    assert.equal(result.loginStatus, 200);
    assert.equal(result.sessionCookie, true);
    assert.equal(result.noHeader, 401);
    assert.equal(result.sameOriginBrowser, 401);
    assert.equal(result.validSession, true);
    assert.equal(result.validHeader, true);
    assert.equal(Object.values(result.protectedReadStatuses).length, 13);
    assert.ok(Object.values(result.protectedReadStatuses).every((status) => status === 401));
    assert.equal(result.agentActivityWithHeader, 200);
    assert.equal(result.agentActivityDetailWithHeader, 404);
    assert.equal(result.protectedStackConfigChangeAccepted, false);
    assert.equal(result.allowedStackConfigChangeAccepted, true);
    assert.equal(result.protectedServiceConfigChangeAccepted, false);
    assert.equal(result.protectedServiceConfigChangeWrongPasswordAccepted, false);
    assert.equal(result.allowedServiceSecretChangeAccepted, true);
    assert.equal(result.passwordAfterProtectedStackConfigChange, 'secret123');
    assert.equal(result.apiKeyPreservedAfterProtectedStackConfigChange, true);
    assert.equal(result.prowlarrApiKeyAfterServiceSecretChange, 'prowlarr-service-secret');
    assert.equal(result.timezoneAfterAllowedStackConfigChange, 'UTC');
    assert.equal(result.identityWithoutPassword, 403);
    assert.equal(result.identityWithPassword, 200);
    assert.equal(result.identitySessionCookie, true);
    assert.equal(result.originalSessionAfterUsernameChange, true);
    assert.equal(result.renewedSessionAfterUsernameChange, true);
    assert.equal(result.passwordChange, 200);
    assert.equal(result.passwordSessionCookie, true);
    assert.equal(result.oldSessionAfterPasswordChange, 401);
    assert.equal(result.renewedSessionAfterPasswordChange, true);
    assert.equal(result.apiKeyChange, 200);
    assert.equal(result.sessionAfterApiKeyChange, true);
    assert.equal(result.oldApiKeyAfterRotation, 401);
    assert.equal(result.newApiKeyAfterRotation, true);
    assert.equal(result.rateLimitStatuses.at(-1), 429);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
