import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StackarrEnv } from '@stackarr/core';
import { type CloudflareSyncDependencies, publishCloudflareEmailAllowlist } from '@stackarr/core/cloudflareSync';

test('email allowlist publish replaces the remote policy before persisting the confirmed list', async () => {
  const writes: StackarrEnv[] = [];
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const env = {
    CLOUDFLARE_API_TOKEN: 'fixture-token',
    CLOUDFLARE_ACCOUNT_ID: 'account-1',
    CLOUDFLARED_TUNNEL_ID: 'tunnel-1',
    CLOUDFLARE_ACCESS_ENABLED: 'true',
    CLOUDFLARE_ACCESS_ALLOWED_EMAILS: 'existing@example.com',
    CLOUDFLARE_ACCESS_SESSION_DURATION: '720h'
  } as StackarrEnv;
  const dependencies: CloudflareSyncDependencies = {
    readEnv: () => env,
    writeEnvConfig: (patch) => {
      writes.push(patch);
      return { ...env, ...patch };
    },
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method, body });
      if (method === 'GET' && url.includes('/access/policies?')) {
        return Response.json({ success: true, result: [{ id: 'policy-1', name: 'Email Allowlist' }] });
      }
      if (method === 'PUT' && url.endsWith('/access/policies/policy-1')) {
        return Response.json({ success: true, result: { id: 'policy-1', name: 'Email Allowlist' } });
      }
      return Response.json({ success: false }, { status: 404 });
    }
  };

  const result = await publishCloudflareEmailAllowlist(['existing@example.com', 'KUTLWANOKM@gmail.com'], dependencies);

  assert.deepEqual(result.allowedEmails, ['existing@example.com', 'kutlwanokm@gmail.com']);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.CLOUDFLARE_ACCESS_ALLOWED_EMAILS, 'existing@example.com,kutlwanokm@gmail.com');
  assert.deepEqual(requests.at(-1), {
    url: 'https://api.cloudflare.com/client/v4/accounts/account-1/access/policies/policy-1',
    method: 'PUT',
    body: {
      name: 'Email Allowlist',
      decision: 'allow',
      include: [{ email: { email: 'existing@example.com' } }, { email: { email: 'kutlwanokm@gmail.com' } }],
      exclude: [],
      require: [],
      session_duration: '720h'
    }
  });
});

test('email allowlist publish rejects invalid or empty lists without writing locally or remotely', async () => {
  let writes = 0;
  let requests = 0;
  const dependencies: CloudflareSyncDependencies = {
    readEnv: () =>
      ({
        CLOUDFLARE_API_TOKEN: 'fixture-token',
        CLOUDFLARE_ACCOUNT_ID: 'account-1',
        CLOUDFLARE_ACCESS_SESSION_DURATION: '720h'
      }) as StackarrEnv,
    writeEnvConfig: (patch) => {
      writes += 1;
      return patch;
    },
    fetch: async () => {
      requests += 1;
      return Response.json({ success: true, result: [] });
    }
  };

  await assert.rejects(() => publishCloudflareEmailAllowlist(['not-an-email'], dependencies), /valid email/i);
  assert.equal(writes, 0);
  assert.equal(requests, 0);
});
