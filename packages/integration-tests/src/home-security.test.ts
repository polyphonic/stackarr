import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const source = (path: string) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');

test('home services are first-class managed services with private host ports', () => {
  const compose = source('stackarr/docker-compose.yml');
  const section = compose.slice(compose.indexOf('  mosquitto:\n'), compose.indexOf('  agregarr:\n'));
  for (const service of ['mosquitto', 'homeassistant', 'frigate']) {
    assert.ok(section.includes(`container_name: ${service}`));
    assert.ok(source('packages/core/src/services.ts').includes(`'${service}'`));
    assert.ok(source('stackarr/scripts/service-apply.sh').includes(service));
    assert.ok(source('packages/mcp/src/registry.ts').includes(`'${service}'`));
  }
  assert.ok(section.includes('${HOMEASSISTANT_BIND_IP:-127.0.0.1}'));
  assert.ok(section.includes('${FRIGATE_BIND_IP:-127.0.0.1}'));
  assert.ok(!section.includes('privileged: true'));
  assert.ok(!section.includes('network_mode: host'));
  for (const port of ['8554:', '8555:', '5000:', '1883:', '2020:']) assert.ok(!section.includes(port));
  assert.ok(section.includes('aliases: [mqtt]'));
  assert.ok(section.includes('/data:/mosquitto/data'));
});

test('prearrival config disables inference and uses current recording schema', () => {
  const compose = source('stackarr/docker-compose.yml');
  const section = compose.slice(compose.indexOf('  frigate:\n'), compose.indexOf('  agregarr:\n'));
  assert.match(section, /detectors: \{\}/);
  assert.match(section, /cameras: \{\}/);
  assert.match(section, /detect:\s+enabled: false/);
  assert.match(section, /continuous:\s+days: 3/);
  assert.match(section, /motion:\s+days: 7/);
  assert.match(section, /shm_size: 128mb/);
  assert.ok(section.includes('required: false'));
});

test('home service topology survives runtime export and UI onboarding', () => {
  const common = source('stackarr/lib/common.sh');
  for (const prefix of ['MOSQUITTO', 'HOMEASSISTANT', 'FRIGATE']) {
    assert.ok(common.includes(`${prefix}_.*`));
    assert.ok(source('stackarr/scripts/runtime-config-export.cjs').includes(`ENABLE_${prefix}`));
  }
  const wizard = source('apps/frontend/src/components/SetupWizard.tsx');
  assert.ok(wizard.includes('ENABLE_HOMEASSISTANT'));
  assert.ok(wizard.includes('ENABLE_FRIGATE'));
  assert.ok(wizard.includes('label="Home Assistant"'));
  assert.ok(wizard.includes('label="Frigate"'));
  assert.ok(source('stackarr/scripts/portless.sh').includes('home'));
});
