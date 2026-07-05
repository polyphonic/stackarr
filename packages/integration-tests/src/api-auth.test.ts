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
          const { POST: login } = await import('./apps/frontend/src/app/api/v1/auth/login/route.ts');
          const { NextRequest } = await import('./apps/frontend/node_modules/next/server.js');

          const commandUrl = 'http://127.0.0.1:7777/api/v1/command';
          const missingKey = requireApiKey(new NextRequest(commandUrl, { method: 'POST' }));
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
              headers: { 'content-type': 'application/json', 'x-api-key': bootstrapBody.apiKey },
              body: JSON.stringify({ config: { USERNAME: 'new-admin' }, currentPassword: 'secret123' })
            })
          );

          console.log(JSON.stringify({
            missingKey: missingKey?.status,
            bootstrapStatus: bootstrapResponse.status,
            generatedKey: typeof bootstrapBody.apiKey === 'string' && bootstrapBody.apiKey.length >= 32,
            badLogin: badLogin.status,
            loginStatus: loginResponse.status,
            sessionCookie: sessionCookie.includes('stackarr_session='),
            noHeader: noHeader?.status,
            sameOriginBrowser: sameOriginBrowser?.status,
            validSession: validSession === null,
            validHeader: validHeader === null,
            identityWithoutPassword: identityWithoutPassword.status,
            identityWithPassword: identityWithPassword.status
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
    assert.equal(result.bootstrapStatus, 200);
    assert.equal(result.generatedKey, true);
    assert.equal(result.badLogin, 401);
    assert.equal(result.loginStatus, 200);
    assert.equal(result.sessionCookie, true);
    assert.equal(result.noHeader, 401);
    assert.equal(result.sameOriginBrowser, 401);
    assert.equal(result.validSession, true);
    assert.equal(result.validHeader, true);
    assert.equal(result.identityWithoutPassword, 403);
    assert.equal(result.identityWithPassword, 200);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
