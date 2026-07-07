import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const stateDir = mkdtempSync(path.join(tmpdir(), 'stackarr-notifications-test-'));
process.env.STACKARR_DATABASE_FILE = path.join(stateDir, 'stackarr.db');

test('webhook notifications do not follow redirects', async () => {
  let webhookRequests = 0;
  let redirectedRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/internal') {
      redirectedRequests += 1;
      response.writeHead(204);
      response.end();
      return;
    }

    webhookRequests += 1;
    response.writeHead(302, { location: '/internal' });
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const { dispatchNotification, writeNotification } = await import('../../core/src/index.ts');
    writeNotification({
      name: 'Redirecting webhook',
      implementation: 'Webhook',
      enabled: true,
      url: `http://127.0.0.1:${address.port}/hook`,
      events: ['Test']
    });

    await dispatchNotification('Test', {});

    assert.equal(webhookRequests, 1);
    assert.equal(redirectedRequests, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
