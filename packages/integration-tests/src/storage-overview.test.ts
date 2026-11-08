import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const frontendRequire = createRequire(path.join(root, 'apps/frontend/package.json'));
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const css = new Proxy({}, { get: (_target, property) => (property === '__esModule' ? false : String(property)) });

// Compile actual TSX, replacing only external boundaries. Render with real React DOM server.
function compile(file: string, resolve: (id: string) => unknown): any {
  const source = readFileSync(path.join(root, 'apps/frontend/src', file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', output)(resolve, module, module.exports);
  return module.exports;
}
const format = compile('lib/formatBinaryBytes.ts', frontendRequire).formatBinaryBytes;
const volumes = compile('components/StorageVolumes.tsx', (id) => {
  if (id.endsWith('.css')) return css;
  if (id.includes('formatBinaryBytes')) return { formatBinaryBytes: format };
  return frontendRequire(id);
});
const home = compile('components/DashboardOverview.tsx', (id) => {
  if (id === './StorageVolumes') return volumes;
  if (id === './ui') return { Grid: 'div', Panel: 'section', Stat: 'span' };
  if (id.endsWith('.css')) return css;
  if (id.includes('formatBinaryBytes')) return { formatBinaryBytes: format };
  return frontendRequire(id);
});
function descendants(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  return [node, ...descendants(node.props.children)];
}
const disk = (
  label: string,
  paths: string[],
  free: number | null = 1024 ** 3,
  total: number | null = 2 * 1024 ** 3
) => ({
  label,
  path: label,
  paths,
  filesystem: '/dev/example',
  mountPoint: label,
  volumeId: label,
  totalSpace: total,
  freeSpace: free,
  usedPercent: free === null || total === null ? null : 50,
  status: free === null ? 'probe-unavailable' : 'available',
  associations: paths.map((requested, index) => ({
    path: requested,
    service: index ? 'plex' : 'romm',
    displayName: index ? 'Plex' : 'RomM',
    reason: 'Library location',
    source: 'native-library',
    status: index ? 'available' : 'missing'
  }))
});
function componentHtml(disks: any[]) {
  return renderToStaticMarkup(React.createElement(volumes.StorageVolumes, { disks }));
}
function triggers(html: string) {
  return [...html.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)].map((match) => match[1]);
}
function assertVolumeMarkup(html: string) {
  const trigger = triggers(html).at(-1);
  assert.ok(trigger, 'volume has a collapsed native keyboard-accessible summary');
  assert.match(html, /<details class="volume">/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(trigger, /Archive/);
  assert.match(trigger, /1\.00 GiB used of 2\.00 GiB · 1\.00 GiB free/);
  assert.match(trigger, /2 locations · 50% used/);
  assert.match(trigger, /class="usageTrack" data-unknown="false" aria-hidden="true"/);
  assert.match(trigger, /class="usageFill" style="width:50%"/);
  assert.doesNotMatch(trigger, /\/mnt\/archive\/library/);
  assert.match(html, /<ul class="locations">/);
  assert.ok(html.indexOf('Plex') < html.indexOf('RomM'), 'sort expanded rows by app');
  assert.match(html, /\/mnt\/archive\/library/);
  assert.match(html, /\/mnt\/archive\/missing/);
  assert.match(html, /Path does not exist/);
  assert.match(html, /class="unavailable">Unavailable<\/span>/);
  assert.doesNotMatch(html, /class="locationTitle available"|class="locations unavailable"/);
}

test('home preserves outer Storage details and nests shared volume summaries', () => {
  const disks = [disk('/Volumes/Archive', ['/mnt/archive/missing', '/mnt/archive/library'])];
  const tree = home.StorageOverview({ metrics: { disks } });
  const outer = descendants(tree).find((element) => element.type === 'details');
  assert.ok(outer);
  assert.equal(outer.props.open, undefined);
  const instance = descendants(outer).find((element) => element.type === volumes.StorageVolumes);
  assert.ok(instance, 'home renders the actual shared component inside the outer accordion');
  const html = renderToStaticMarkup(tree);
  assert.match(html, /^<details class="storageAccordion"><summary class="storageAccordionSummary">/);
  assert.match(html, /1\.00 GiB available of 2\.00 GiB.*1 mounted drives/);
  assertVolumeMarkup(html);
});

test('disk page consumes the same shared volume component and real rendered markup', async () => {
  const disks = [disk('/Volumes/Archive', ['/mnt/archive/missing', '/mnt/archive/library'])];
  const shell = Object.fromEntries(
    [
      'ActivityNav',
      'PageBody',
      'Toolbar',
      'BackupRecoveryKey',
      'CommandButton',
      'PortlessHostCommands',
      'ServerLogViewer',
      'SubNav',
      'TaskProgressView',
      'ActionGrid',
      'Badge',
      'Grid',
      'Panel',
      'Stat',
      'Table'
    ].map((name) => [
      name,
      name === 'Panel' ? (props: any) => React.createElement('section', {}, props.children) : 'div'
    ])
  );
  shell.StorageVolumes = volumes.StorageVolumes;
  const page = compile('app/system/[section]/page.tsx', (id) => {
    if (id === '@stackarr/core')
      return {
        getSystemStatus: () => ({}),
        readEnv: () => ({ ENABLE_BACKUP: 'false' }),
        getStackMetrics: () => ({ disks }),
        readTasks: () => [],
        getBackupRecoveryKeyStatusAction: () => ({})
      };
    if (id === 'node:fs') return { existsSync: () => false };
    if (id === 'next/navigation')
      return {
        notFound: () => {
          throw Error('unexpected section');
        }
      };
    if (id.endsWith('/serverAuth')) return { requireDashboardAuth: async () => {} };
    if (id.startsWith('../../../components/')) return shell;
    return frontendRequire(id);
  });
  const tree = await page.default({ params: Promise.resolve({ section: 'diskspace' }) });
  const instance = descendants(tree).find((element) => element.type === volumes.StorageVolumes);
  assert.deepEqual(instance?.props.disks, disks);
  assertVolumeMarkup(renderToStaticMarkup(tree));
});

test('collapsed trigger preserves neutral unknown capacity and exact display-only macOS prefix', () => {
  for (const [label, displayed] of [
    ['/Volumes/Archive', 'Archive'],
    ['/Volumes/Archive/sub', 'Archive/sub'],
    ['/Volumes/', '/Volumes/'],
    ['/Volumes//Archive', '/Volumes//Archive'],
    ['/volumes/Archive', '/volumes/Archive'],
    ['/mnt/Archive', '/mnt/Archive'],
    ['/', '/']
  ]) {
    const source = disk(label, ['/Volumes/Archive/library'], null, null);
    const original = structuredClone(source);
    const html = componentHtml([source]);
    const trigger = triggers(html)[0];
    assert.ok(trigger.includes(`>${displayed}</strong>`), `${label}: ${trigger}`);
    assert.match(trigger, /Capacity unavailable · 1 location/);
    assert.match(trigger, /class="usageTrack" data-unknown="true" aria-hidden="true"/);
    assert.doesNotMatch(trigger, /usageFill|% used|NaN|Infinity/);
    assert.match(html, /\/Volumes\/Archive\/library/);
    assert.deepEqual(source, original);
  }
});

test('zero capacity has no invented percent; fallback paths remain visible without associations', () => {
  const zero = disk('/mnt/zero', ['/mnt/zero/library'], 0, 0);
  zero.associations = [];
  zero.status = 'not-enrolled';
  const html = componentHtml([zero]);
  const trigger = triggers(html)[0];
  assert.match(trigger, /0 B used of 0 B · 0 B free · 1 location/);
  assert.match(trigger, /data-unknown="true"/);
  assert.doesNotMatch(trigger, /% used|usageFill/);
  assert.match(html, /<code>\/mnt\/zero\/library<\/code>/);
  assert.match(html, /Path is not enrolled for capacity reporting/);
  assert.doesNotMatch(html, /Expected volume is not mounted/);
});

test('each volume is independently collapsed with stable unique element keys and status-only colours', () => {
  const sameLabel = disk('/mnt/same', ['/mnt/one'], null, null);
  const other = disk('/mnt/same', ['/mnt/two'], null, null);
  const tree = volumes.StorageVolumes({ disks: [sameLabel, other] });
  const entries = descendants(tree).filter((element) => element.type === 'details');
  assert.equal(entries.length, 2);
  assert.equal(new Set(entries.map((entry) => entry.key)).size, 2);
  const html = componentHtml([sameLabel, other]);
  assert.equal(triggers(html).length, 2);
  assert.doesNotMatch(html, /Verify host mount/);
  assert.match(html, /Path does not exist/);
});
