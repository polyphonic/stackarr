import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('custom script notifications execute via spawn passing payload via args, env, and stdin', async () => {
  const scriptDir = mkdtempSync(path.join(tmpdir(), 'stackarr-script-test-'));
  const scriptPath = path.join(scriptDir, 'notify.sh');
  const logFile = path.join(scriptDir, 'output.json');

  const scriptContent = `#!/bin/bash
stdin_content=$(cat)
cat <<EOF > "${logFile}"
{
  "argEvent": "$1",
  "argPayload": $2,
  "envEvent": "$STACKARR_EVENT",
  "envPayload": $STACKARR_PAYLOAD,
  "stdinPayload": $stdin_content
}
EOF
`;

  writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

  try {
    const { dispatchNotification, writeNotification } = await import('../../core/src/index.ts');
    writeNotification({
      name: 'Test custom script',
      implementation: 'CustomScript',
      enabled: true,
      path: scriptPath,
      events: ['Backup']
    });

    await dispatchNotification('Backup', { detail: 'database-dump-ok' });

    assert.ok(existsSync(logFile), 'Script output file should exist');
    const logData = JSON.parse(readFileSync(logFile, 'utf8'));

    assert.equal(logData.argEvent, 'Backup');
    assert.equal(logData.envEvent, 'Backup');
    assert.equal(logData.argPayload.detail, 'database-dump-ok');
    assert.equal(logData.envPayload.detail, 'database-dump-ok');
    assert.equal(logData.stdinPayload.detail, 'database-dump-ok');
  } finally {
    rmSync(scriptDir, { recursive: true, force: true });
  }
});
