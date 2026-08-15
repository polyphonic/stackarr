import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function functionRange(source: string, first: string, next: string): string {
  const start = source.indexOf(`${first}() {`);
  const end = source.indexOf(`\n${next}() {`, start);
  assert.notEqual(start, -1, `missing ${first}`);
  assert.notEqual(end, -1, `missing boundary ${next}`);
  return source.slice(start, end);
}

test('Radarr DCP formats and profile scores are applied through the API contract', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-dcp-policy-'));
  const harness = path.join(root, 'configure-policy.sh');
  const configure = await readFile(new URL('../../../stackarr/scripts/configure.sh', import.meta.url), 'utf8');
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const customFormats: Array<Record<string, unknown>> = [];
  const profiles = [{ id: 31, name: 'HD Lite', formatItems: [], minFormatScore: -1 }];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const method = request.method ?? 'GET';
      const requestPath = request.url ?? '/';
      assert.equal(request.headers['x-api-key'], 'fixture-key');

      if (method === 'GET') {
        const payload = requestPath === '/qualityprofile' ? profiles : customFormats;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(payload));
        return;
      }

      const parsed = JSON.parse(body) as Record<string, unknown>;
      writes.push({ method, path: requestPath, body: parsed });
      if (method === 'POST' && requestPath === '/customformat') {
        parsed.id = customFormats.length + 11;
        customFormats.push(parsed);
        response.writeHead(201, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(parsed));
        return;
      }

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(parsed));
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const apiHelpers = functionRange(configure, 'api_post_json', 'api_delete');
    const formatHelpers = functionRange(
      configure,
      'ensure_custom_format_release_title',
      'ensure_request_quality_profile'
    );
    const profileHelper = functionRange(
      configure,
      'ensure_quality_profile_custom_formats',
      'ensure_quality_definition_caps'
    );

    await writeFile(
      harness,
      [
        '#!/bin/bash',
        'set -euo pipefail',
        'ok() { :; }',
        'warn() { :; }',
        apiHelpers,
        formatHelpers,
        profileHelper,
        'ensure_custom_format_release_title "DCP fixture" "$BASE_URL/customformat" "$BASE_URL/customformat" "$BASE_URL/customformat" fixture-key "DCP Rip" "(^|[ ._-])DCP([ ._-]|$)" false',
        'ensure_custom_format_non_dcp_hdtv "Non-DCP fixture" "$BASE_URL/customformat" "$BASE_URL/customformat" "$BASE_URL/customformat" fixture-key "Non-DCP HDTV" "(^|[ ._-])DCP([ ._-]|$)"',
        'ensure_quality_profile_custom_formats "DCP scores fixture" "$BASE_URL/qualityprofile" "$BASE_URL/qualityprofile" "$BASE_URL/customformat" fixture-key "HD Lite" "Non-DCP HDTV:-100000,DCP Rip:20000" 0 20000 1',
        ''
      ].join('\n')
    );

    await execFile('bash', [harness], { cwd: repoRoot, env: { ...process.env, BASE_URL: baseUrl } });

    assert.equal(writes.length, 3);
    const dcp = writes[0].body;
    assert.equal(dcp.name, 'DCP Rip');
    const dcpSpecifications = dcp.specifications as Array<Record<string, unknown>>;
    assert.equal(dcpSpecifications.length, 1);
    assert.equal(dcpSpecifications[0].implementation, 'ReleaseTitleSpecification');
    assert.equal(dcpSpecifications[0].negate, false);
    assert.equal(dcpSpecifications[0].required, true);

    const nonDcp = writes[1].body;
    const nonDcpSpecifications = nonDcp.specifications as Array<Record<string, unknown>>;
    assert.equal(nonDcpSpecifications[0].implementation, 'SourceSpecification');
    const sourceFields = nonDcpSpecifications[0].fields as Array<Record<string, unknown>>;
    assert.equal(sourceFields[0].name, 'value');
    assert.equal(sourceFields[0].value, 6);
    assert.equal(nonDcpSpecifications[1].implementation, 'ReleaseTitleSpecification');
    assert.equal(nonDcpSpecifications[1].negate, true);

    const profileWrite = writes[2];
    assert.equal(profileWrite.method, 'PUT');
    assert.equal(profileWrite.path, '/qualityprofile/31');
    assert.deepEqual(profileWrite.body.formatItems, [
      { format: 12, name: 'Non-DCP HDTV', score: -100000 },
      { format: 11, name: 'DCP Rip', score: 20000 }
    ]);
    assert.equal(profileWrite.body.minFormatScore, 0);
    assert.equal(profileWrite.body.cutoffFormatScore, 20000);
    assert.equal(profileWrite.body.minUpgradeFormatScore, 1);
  } finally {
    if (server.listening) server.close();
    await rm(root, { recursive: true, force: true });
  }
});
