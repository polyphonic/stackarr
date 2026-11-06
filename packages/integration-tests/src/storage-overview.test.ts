import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { formatBinaryBytes } from '../../../apps/frontend/src/lib/formatBinaryBytes';
import { type DiskUsage, diskUsageKey, groupDiskUsages } from '../../core/src/metrics';

type Element = { type: any; key: string | null; props: Record<string, any> };
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const frontendRequire = createRequire(path.join(repoRoot, 'apps/frontend/package.json'));
const compile = (file: string, loader: (id: string) => unknown) => {
  const source = readFileSync(path.join(repoRoot, file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', compiled)(loader, module, module.exports);
  return module.exports;
};
const accordion = Object.assign((props: any) => props.children, {
  Item: 'item',
  Heading: 'heading',
  Trigger: 'trigger',
  Indicator: 'indicator',
  Panel: 'panel',
  Body: 'body'
});
const volumes = compile('apps/frontend/src/components/StorageVolumes.tsx', (id) =>
  id === '@stackarr/ui'
    ? { Accordion: accordion }
    : id.endsWith('diskUsageIdentity')
      ? { diskUsageKey }
      : id.endsWith('.css')
        ? {
            volumes: 'volumes',
            volume: 'volume',
            trigger: 'trigger',
            heading: 'heading',
            usageTrack: 'usageTrack',
            usageFill: 'usageFill',
            locations: 'locations',
            available: 'available',
            unavailable: 'unavailable',
            reason: 'reason',
            locationTitle: 'title'
          }
        : id.includes('formatBinaryBytes')
          ? { formatBinaryBytes }
          : frontendRequire(id)
);
const home = compile('apps/frontend/src/components/DashboardOverview.tsx', (id) =>
  id === './StorageVolumes'
    ? volumes
    : id === './ui'
      ? { Grid: 'grid', Panel: 'panel', Stat: 'stat' }
      : id.endsWith('.css')
        ? { storageSummary: 'storageSummary' }
        : id.includes('formatBinaryBytes')
          ? { formatBinaryBytes }
          : frontendRequire(id)
);

function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (value && typeof value === 'object' && 'props' in value) {
    const element = value as Element;
    return [element, ...elements(element.props.children)];
  }
  return [];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (value && typeof value === 'object' && 'props' in value) return text((value as Element).props.children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function rows(disks: DiskUsage[]) {
  const tree = volumes.StorageVolumes({ disks });
  const accordion = elements(tree).find((v) => v.type === accordionComponent)!;
  assert.deepEqual(accordion.props.defaultExpandedKeys, []);
  return elements(tree).filter((v) => v.type === 'item');
}
const accordionComponent = accordion;
async function pageRows(disks: DiskUsage[]) {
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
    ].map((name) => [name, name])
  );
  shell.StorageVolumes = 'StorageVolumes';
  const page = compile('apps/frontend/src/app/system/[section]/page.tsx', (id) => {
    if (id === '@stackarr/core')
      return {
        getSystemStatus: () => ({}),
        readEnv: () => ({ ENABLE_BACKUP: 'false' }),
        getConfiguredStackMetrics: async () => ({ disks }),
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
    if (id.endsWith('/formatBinaryBytes')) return { formatBinaryBytes };
    if (id.startsWith('../../../components/')) return shell;
    return frontendRequire(id);
  });
  const tree = await page.default({ params: Promise.resolve({ section: 'diskspace' }) });
  const instances = elements(tree).filter((v) => v.type === 'StorageVolumes');
  assert.equal(instances.length, 1);
  return rows(instances[0].props.disks);
}
function disk(
  requested: string,
  status: 'available' | 'missing' | 'unmounted' = 'available',
  mount = '/mnt/archive',
  uuid = 'device-a'
): DiskUsage {
  return {
    label: mount,
    path: mount,
    paths: [requested],
    filesystem: status === 'available' ? '/dev/fixture' : null,
    mountPoint: status === 'available' ? mount : null,
    volumeId: status === 'available' ? uuid : undefined,
    freeSpace: status === 'available' ? 1024 ** 3 : null,
    totalSpace: status === 'available' ? 2 * 1024 ** 3 : null,
    usedPercent: status === 'available' ? 50 : null,
    status,
    associations: [
      {
        path: requested,
        service: requested.includes('romm') ? 'romm' : 'plex',
        displayName: requested.includes('romm') ? 'RomM' : 'Plex',
        reason: 'Library location',
        source: 'native-library',
        status
      }
    ]
  };
}
for (const consumer of ['home', 'disk page'] as const) {
  test(`${consumer} shares a collapsed volume list with sorted, truthful path statuses`, async () => {
    const available = disk('/mnt/archive/plex');
    const missing = disk('/mnt/archive/romm', 'missing');
    missing.enclosingMount = {
      filesystem: '/dev/fixture',
      mountPoint: '/mnt/archive',
      volumeId: 'device-a',
      realAnchor: '/mnt/archive',
      anchor: '/mnt/archive',
      filesystemType: 'ext4'
    };
    const grouped = groupDiskUsages([missing, available]);
    const reverse = groupDiskUsages([available, missing]);
    assert.equal(grouped.length, 1);
    assert.equal(reverse.length, 1);
    assert.deepEqual(grouped[0].paths.slice().sort(), reverse[0].paths.slice().sort());
    assert.equal(grouped[0].totalSpace, 2 * 1024 ** 3);
    const homeTree = home.StorageOverview({
      metrics: { disks: grouped, serviceCounts: { dockerRunning: 0 }, performance: {} }
    });
    const instance = elements(homeTree).find((v) => v.type === volumes.StorageVolumes)!;
    assert.deepEqual(instance.props.disks, grouped);
    const list = consumer === 'home' ? rows(instance.props.disks) : await pageRows(grouped);
    assert.equal(list.length, 1);
    assert.match(text(list), /2 locations/);
    assert.match(text(list), /1.00 GiB used of 2.00 GiB/);
    const items = elements(list[0]).filter((v) => v.type === 'li');
    assert.equal(items.length, 2, JSON.stringify(items.map(text)));
    assert.match(text(items[0]), /PlexAvailable/);
    assert.match(text(items[1]), /RomMUnavailable/);
    assert.match(text(items[1]), /Path does not exist/);
    assert.equal(elements(items[0]).find((v) => v.props.className === 'available')?.type, 'span');
    assert.equal(elements(items[1]).find((v) => v.props.className === 'unavailable')?.type, 'span');
    assert.equal(rows(reverse)[0].key, list[0].key);
    const extra = disk('/mnt/archive/romm-z', 'missing');
    extra.associations![0].displayName = 'RomM';
    extra.enclosingMount = missing.enclosingMount;
    const ordered = rows(groupDiskUsages([extra, missing, available]))[0];
    assert.deepEqual(
      elements(ordered)
        .filter((v) => v.type === 'li')
        .map(text),
      [text(items[0]), text(items[1]), 'RomMUnavailableLibrary location/mnt/archive/romm-zPath does not exist']
    );
  });
  test(`${consumer} shortens only the exact macOS display prefix without changing paths or identity`, async () => {
    const cases = [
      ['/Volumes/Archive', 'Archive'],
      ['/Volumes/External Drive', 'External Drive'],
      ['/Volumes/Archive/nested', 'Archive/nested'],
      ['Macintosh HD', 'Macintosh HD'],
      ['Internal storage', 'Internal storage'],
      ['/', '/'],
      ['/Volumes', '/Volumes'],
      ['/Volumes/', '/Volumes/'],
      ['/Volumes//Archive', '/Volumes//Archive'],
      ['/volumes/Archive', '/volumes/Archive'],
      ['/VolumesExtra/Archive', '/VolumesExtra/Archive'],
      ['/mnt/Volumes/Archive', '/mnt/Volumes/Archive'],
      ['/mnt/archive', '/mnt/archive'],
      ['C:\\Archive', 'C:\\Archive']
    ];
    for (const [label, expected] of cases) {
      const input = disk('/Volumes/Archive/library');
      input.label = label;
      const original = structuredClone(input);
      const row = (consumer === 'home' ? rows([input]) : await pageRows([input]))[0];
      const trigger = elements(row).find((v) => v.type === 'trigger')!;
      assert.equal(text(elements(trigger).find((v) => v.type === 'strong')), expected);
      assert.equal(row.key, diskUsageKey(input));
      assert.equal(text(elements(row).find((v) => v.type === 'code')), '/Volumes/Archive/library');
      assert.deepEqual(input, original);
    }
  });
  test(`${consumer} keeps a noninteractive usage bar and equivalent text inside the collapsed trigger`, async () => {
    for (const [free, percent] of [
      [0, 100],
      [1024 ** 3, 50],
      [2 * 1024 ** 3, 0]
    ]) {
      const input = disk('/mnt/archive/plex');
      input.freeSpace = free;
      const row = (consumer === 'home' ? rows([input]) : await pageRows([input]))[0];
      const trigger = elements(row).find((v) => v.type === 'trigger')!;
      const track = elements(trigger).find((v) => v.props.className === 'usageTrack')!;
      assert.ok(track, 'usage bar must be inside the always-visible trigger');
      assert.equal(track.props['aria-hidden'], 'true');
      assert.equal(track.props['data-unknown'], false);
      assert.equal(track.props.tabIndex, undefined);
      const fill = elements(track).find((v) => v.props.className === 'usageFill')!;
      assert.equal(fill.props.style.width, `${percent}%`);
      assert.match(text(trigger), new RegExp(`${percent}% used`));
      assert.match(text(trigger), /used of 2.00 GiB.*free.*1 location/);
      assert.equal(elements(row).filter((v) => v.props.className === 'usageTrack').length, 1);
    }
  });
  test(`${consumer} never invents a percentage for unknown or zero capacity`, async () => {
    for (const [totalSpace, freeSpace] of [
      [null, null],
      [1024, null],
      [null, 1024],
      [0, 0]
    ]) {
      const input = disk('/mnt/archive/plex', 'unmounted');
      Object.assign(input, { totalSpace, freeSpace, usedPercent: null });
      const row = (consumer === 'home' ? rows([input]) : await pageRows([input]))[0];
      const trigger = elements(row).find((v) => v.type === 'trigger')!;
      const track = elements(trigger).find((v) => v.props.className === 'usageTrack')!;
      assert.ok(track);
      assert.equal(track.props['data-unknown'], true);
      assert.equal(
        elements(track).some((v) => v.props.className === 'usageFill'),
        false
      );
      assert.doesNotMatch(text(trigger), /%|NaN|Infinity/);
      assert.match(text(trigger), /1 location/);
      if (totalSpace === null || freeSpace === null) assert.match(text(trigger), /Capacity unavailable/);
    }
  });
  test(`${consumer} does not coalesce a clone, an unmounted path, or a mere matching label`, async () => {
    const a = disk('/mnt/archive/plex');
    const clone = disk('/mnt/clone/plex', 'available', '/mnt/clone', 'device-a');
    clone.label = a.label;
    const unmounted = disk('/mnt/archive/romm', 'unmounted');
    const unproven = disk('/mnt/archive/future', 'missing');
    const disks = groupDiskUsages([a, clone, unmounted, unproven]);
    assert.equal(disks.length, 4);
    const list = consumer === 'home' ? rows(disks) : await pageRows(disks);
    assert.equal(new Set(list.map((v) => v.key)).size, 4);
    assert.match(text(list.find((v) => text(v).includes('/mnt/archive/romm'))), /Expected volume is not mounted/);
    assert.match(text(list.find((v) => text(v).includes('/mnt/archive/romm'))), /Capacity unavailable/);
  });
}
