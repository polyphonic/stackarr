import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { requestJson, ServiceApiError } from '../../core/src/clients/http';

test('HTTP client preserves status for non-JSON rate-limit responses', async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 429;
    response.setHeader('content-type', 'text/plain');
    response.end('Too many requests');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await assert.rejects(requestJson(`http://127.0.0.1:${address.port}/api/games`), (error: unknown) => {
      assert.ok(error instanceof ServiceApiError);
      assert.equal(error.status, 429);
      assert.deepEqual(error.details, { message: 'Too many requests' });
      return true;
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
