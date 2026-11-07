import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { evaluateImageUpdate } = require('../../../stackarr/scripts/image-update-policy.cjs');
const { main } = require('../../../stackarr/scripts/image-update-gate.cjs');
const from = 'example/app:1.2.0',
  candidate = 'example/app:1.3.0';
const current = { reference: from, imageId: `sha256:${'c'.repeat(64)}` };
const release = {
  image: candidate,
  previous: from,
  evidence: { citation: 'https://example.test/release', confidence: 'verified' },
  requirements: [
    {
      engine: 'postgresql',
      version: { min: '16.0', max: '18.9' },
      extensions: [{ name: 'vector', version: { min: '0.8', max: '0.9' } }]
    },
    { engine: 'redis', version: { min: '7.0', max: '8.9' } }
  ]
};
const readings = {
  postgresql: { version: '18.4', extensions: [{ name: 'vector', version: '0.8' }] },
  redis: { version: '8.1' }
};
const evaluate = (change: Record<string, any> = {}) =>
  evaluateImageUpdate({ service: 'app', current, candidate: { reference: candidate }, release, readings, ...change });
test('compatible minor update proceeds; unknown ranges warn, not freeze', () => {
  assert.equal(evaluate().decision, 'ALLOW');
  assert.equal(evaluate({ release: undefined }).decision, 'ALLOW');
  assert.match(evaluate({ release: undefined }).warnings.join(' '), /unknown/);
  assert.match(evaluate({ release: { image: candidate } }).warnings.join(' '), /undocumented/);
  assert.equal(evaluate({ current: null }).decision, 'ALLOW');
  assert.equal(evaluate({ candidate: { reference: from }, release: undefined }).decision, 'UNCHANGED');
});
test('explicit incompatibility and required engine transition hold without upgrading engines', () => {
  assert.equal(
    evaluate({ readings: { ...readings, postgresql: { ...readings.postgresql, version: '15.0' } } }).decision,
    'HOLD'
  );
  assert.equal(
    evaluate({ readings: { ...readings, postgresql: { version: '18.4', extensions: [] } } }).decision,
    'HOLD'
  );
  assert.equal(evaluate({ release: { ...release, incompatible: true } }).decision, 'HOLD');
  assert.equal(evaluate({ release: { ...release, requiresEngineChange: true } }).decision, 'HOLD');
  const advisory = {
    ...release,
    incompatibilities: [{ engine: 'redis', version: { min: '8.0', max: '8.9' }, reason: 'cited release advisory' }]
  };
  assert.equal(evaluate({ release: advisory }).decision, 'HOLD');
  assert.equal(
    evaluate({ release: advisory, readings: {} }).decision,
    'HOLD',
    'cannot exclude a documented incompatibility without a reading'
  );
  assert.equal(evaluate({ service: 'database' }).decision, 'HOLD');
});
test('major and non-semver transitions prompt assessment, not blanket bans', () => {
  assert.match(
    evaluate({ candidate: { reference: 'example/app:2.0.0' }, release: undefined }).warnings.join(' '),
    /major.*assess/
  );
  assert.match(
    evaluate({ candidate: { reference: 'example/app:rolling' }, release: undefined }).warnings.join(' '),
    /non-semver.*assess/
  );
});
test('gate reads optional release matrix and holds known incompatible release', async () => {
  const dir = mkdtempSync(path.join(process.env.TMPDIR!, 'stackarr-release-matrix-'));
  try {
    const file = path.join(dir, 'matrix.json');
    writeFileSync(
      file,
      JSON.stringify({ services: { app: { releases: { [candidate]: { ...release, incompatible: true } } } } })
    );
    const container = {
      Id: 'd'.repeat(64),
      Config: {
        Image: from,
        Labels: { 'com.docker.compose.project': 'stackarr', 'com.docker.compose.service': 'app' }
      },
      Image: current.imageId
    };
    const input = JSON.stringify({ services: { app: { image: candidate } } });
    const run = () => JSON.stringify([container]);
    const logs: string[] = [];
    const options = {
      args: [`app=${'d'.repeat(64)}`],
      env: { COMPOSE_PROJECT_NAME: 'stackarr', STACKARR_RELEASE_COMPATIBILITY_FILE: file },
      input,
      run,
      log: (line: string) => logs.push(line)
    };
    assert.equal(await main(options), 75);
    assert.match(logs.join(' '), /HOLD/);
    assert.equal(await main({ ...options, env: { COMPOSE_PROJECT_NAME: 'stackarr' } }), 0);
    assert.equal(await main({ ...options, args: ['app'] }), 0);
    await assert.rejects(main({ ...options, args: ['app=eeeeeeeeeeee'] }), /identity/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
