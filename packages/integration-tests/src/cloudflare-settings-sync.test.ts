import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { StackarrEnv } from '@stackarr/core';
import { type CloudflareSyncDependencies, syncCloudflareRuntimeConfig } from '@stackarr/core/cloudflareSync';

test('Cloudflare settings sync recovers credentials and hydrates managed and external remote state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-cloudflare-settings-sync-'));
  const stateRoot = path.join(root, 'state');
  const connectorToken = Buffer.from(JSON.stringify({ a: 'account-1', t: 'tunnel-1' })).toString('base64url');
  const writes: StackarrEnv[] = [];

  try {
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, 'cloudflare-api-token'), 'active-api-token\n', { mode: 0o600 });
    await writeFile(path.join(stateRoot, 'cloudflared-token'), `${connectorToken}\n`, { mode: 0o600 });

    const env = {
      STATE_ROOT: stateRoot,
      STACKARR_WEB_PORT: '7777',
      CLOUDFLARE_API_TOKEN: '',
      CLOUDFLARE_ACCOUNT_ID: '',
      CLOUDFLARE_ZONE_ID: '',
      CLOUDFLARED_TUNNEL_ID: '',
      CLOUDFLARED_TUNNEL_NAME: 'stackarr',
      CLOUDFLARE_TUNNEL_ROUTES: '',
      CLOUDFLARE_ACCESS_ENABLED: 'false',
      CLOUDFLARE_ACCESS_ALLOWED_EMAILS: '',
      CLOUDFLARE_ACCESS_SESSION_DURATION: '720h'
    } as StackarrEnv;
    const dependencies: CloudflareSyncDependencies = {
      readEnv: () => env,
      writeEnvConfig: (patch) => {
        writes.push(patch);
        return { ...env, ...patch };
      },
      fetch: fakeCloudflareFetch
    };

    const result = await syncCloudflareRuntimeConfig(dependencies);

    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.CLOUDFLARE_API_TOKEN, 'active-api-token');
    assert.equal(writes[0]?.CLOUDFLARE_ACCOUNT_ID, 'account-1');
    assert.equal(writes[0]?.CLOUDFLARED_TUNNEL_ID, 'tunnel-1');
    assert.equal(writes[0]?.CLOUDFLARED_TUNNEL_NAME, 'Stackarr live');
    assert.equal(writes[0]?.CLOUDFLARE_ACCESS_ENABLED, 'true');
    assert.equal(writes[0]?.CLOUDFLARE_ACCESS_ALLOWED_EMAILS, 'member@example.com,second@example.com');
    assert.equal(writes[0]?.CLOUDFLARE_ACCESS_SESSION_DURATION, '720h');
    assert.deepEqual(JSON.parse(writes[0]?.CLOUDFLARE_TUNNEL_ROUTES ?? '[]'), [
      { hostname: 'stack.example.com', service: 'stackarr', access: true },
      { hostname: 'photos.example.com', service: 'immich', access: false },
      { hostname: 'movies.example.com', service: 'radarr', access: false }
    ]);
    assert.deepEqual(result.externalRoutes, [
      {
        hostname: 'other.example.com',
        target: 'http://host.docker.internal:9120/',
        access: true
      },
      {
        hostname: 'foreign.example.com',
        target: 'http://otherhost:7878',
        access: false
      }
    ]);
    assert.equal(result.apiTokenConfigured, true);
    assert.equal(result.managedRoutes.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function fakeCloudflareFetch(input: string | URL | Request) {
  const url = String(input);
  if (url.endsWith('/accounts/account-1/cfd_tunnel/tunnel-1')) {
    return Response.json({ success: true, result: { id: 'tunnel-1', name: 'Stackarr live' } });
  }
  if (url.endsWith('/accounts/account-1/cfd_tunnel/tunnel-1/configurations')) {
    return Response.json({
      success: true,
      result: {
        config: {
          ingress: [
            { hostname: 'stack.example.com', service: 'http://127.0.0.1:7777' },
            { hostname: 'photos.example.com', service: 'http://127.0.0.1:2283' },
            { hostname: 'movies.example.com', service: 'http://radarr:7878' },
            { hostname: 'other.example.com', service: 'http://fixture-user:fixture-pass@host.docker.internal:9120' },
            { hostname: 'foreign.example.com', service: 'http://otherhost:7878' },
            { service: 'http_status:404' }
          ]
        }
      }
    });
  }
  if (url.includes('/accounts/account-1/access/apps?')) {
    return Response.json({
      success: true,
      result: [
        { type: 'self_hosted', domain: 'stack.example.com', session_duration: '720h' },
        { type: 'self_hosted', domain: 'other.example.com', session_duration: '720h' }
      ]
    });
  }
  if (url.includes('/accounts/account-1/access/policies?')) {
    return Response.json({
      success: true,
      result: [
        {
          name: 'Email Allowlist',
          include: [{ email: { email: 'Member@example.com' } }, { email: { email: 'second@example.com' } }]
        }
      ]
    });
  }
  if (url.includes('/zones?name=')) {
    return Response.json({ success: true, result: [{ id: 'zone-1', name: 'example.com' }] });
  }

  return Response.json({ success: false, errors: [{ message: `Unexpected request: ${url}` }] }, { status: 404 });
}
