import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { formatBinaryBytes } from '../../../apps/frontend/src/lib/formatBinaryBytes';
import type { StackarrEnv } from '../../core/src/env';
import { configuredDiskUsages, type DiskUsage, diskUsageKey, diskUsages } from '../../core/src/metrics';
import type { StorageAssociation } from '../../core/src/serviceStorage';

type Element = { type: unknown; key: string | null; props: { children?: unknown; className?: string } };
const frontendRequire = createRequire(path.resolve('apps/frontend/package.json'));
// Execute the production TSX and real React JSX runtime. Only CSS and the UI
// shell are inert, so this checks component output without a browser or Next server.
const source = readFileSync('apps/frontend/src/components/DashboardOverview.tsx', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const component = { exports: {} as { StorageOverview: (props: { metrics: { disks: DiskUsage[] } }) => Element } };
new Function('require', 'module', 'exports', compiled)(
  (id: string) =>
    id === '@stackarr/core'
      ? { diskUsageKey }
      : id.endsWith('.css')
        ? { disks: 'disks', diskRow: 'diskRow', storageSummary: 'storageSummary' }
        : id === './ui'
          ? { Grid: 'grid', Panel: 'panel', Stat: 'stat' }
          : id.includes('formatBinaryBytes')
            ? { formatBinaryBytes }
            : frontendRequire(id),
  component,
  component.exports
);

async function renderDiskPage(disks: DiskUsage[]) {
  const source = readFileSync('apps/frontend/src/app/system/[section]/page.tsx', 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  }).outputText;
  const page = { exports: {} as { default: (props: { params: Promise<{ section: string }> }) => Promise<Element> } };
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
  new Function('require', 'module', 'exports', compiled)(
    (id: string) => {
      if (id === '@stackarr/core')
        return {
          diskUsageKey,
          getSystemStatus: () => ({}),
          readEnv: () => ({ ENABLE_BACKUP: 'false' }),
          getConfiguredStackMetrics: async () => ({ disks }),
          readTasks: () => [],
          getBackupRecoveryKeyStatusAction: () => ({})
        };
      // The disk page also loads backup status and auth. Keep those external
      // boundaries inert and never inspect the installed host in component tests.
      if (id === 'node:fs') return { existsSync: () => false };
      if (id === 'next/navigation')
        return {
          notFound: () => {
            throw new Error('unexpected section');
          }
        };
      if (id.endsWith('/serverAuth')) return { requireDashboardAuth: async () => {} };
      if (id.endsWith('/formatBinaryBytes')) return { formatBinaryBytes };
      if (id.startsWith('../../../components/')) return shell;
      return frontendRequire(id);
    },
    page,
    page.exports
  );
  const tree = await page.exports.default({ params: Promise.resolve({ section: 'diskspace' }) });
  return elements(tree).filter((element) => element.type === 'tr' && element.key !== null);
}

for (const consumer of ['home', 'disk page'] as const) {
  test(`${consumer} counts mixed state/library UUID metadata once in both discovery orders`, async () => {
    const roots: StorageAssociation[] = [
      { path: '/mnt/data/state', service: 'stackarr', reason: 'State Root', source: 'configuration' },
      { path: '/mnt/data/library', service: 'plex', reason: 'Library location', source: 'native-library' }
    ];
    let key: string | null | undefined;
    for (const order of [roots, [...roots].reverse()]) {
      const disks = await configuredDiskUsages(
        {} as StackarrEnv,
        (paths) =>
          diskUsages(paths, (requested) => ({
            label: '/mnt/data',
            path: '/mnt/data',
            paths: [requested],
            filesystem: '/dev/fixture',
            mountPoint: '/mnt/data',
            ...(requested.endsWith('library') ? { volumeId: 'fixture-volume' } : {}),
            status: 'available',
            freeSpace: 1024 ** 3,
            totalSpace: 2 * 1024 ** 3,
            usedPercent: 50
          })),
        async () => ({ roots: order, issues: [] })
      );
      const rows = consumer === 'home' ? render(disks).rows : await renderDiskPage(disks);
      assert.equal(rows.length, 1);
      assert.ok(rows[0].key);
      if (key) assert.equal(rows[0].key, key);
      key = rows[0].key;
      assert.match(text(rows), /stackarr: State Root/);
      assert.match(text(rows), /plex: Library location/);
      assert.match(text(rows), /\/mnt\/data\/state/);
      assert.match(text(rows), /\/mnt\/data\/library/);
      if (consumer === 'home') {
        assert.equal(text(render(disks).summary), 'Total capacity2.00 GiBUsed1.00 GiBAvailable1.00 GiBMounted drives1');
      } else {
        assert.match(text(rows), /2.00 GiB/);
      }
    }
  });

  test(`${consumer} cannot bridge conflicting UUID proofs through a UUID-less state path`, async () => {
    const roots: StorageAssociation[] = ['state', 'library-a', 'library-b'].map((name) => ({
      path: `/mnt/data/${name}`,
      service: name === 'state' ? 'stackarr' : 'plex',
      reason: name,
      source: name === 'state' ? 'configuration' : 'native-library'
    }));
    const keys = new Map<string, string | null>();
    // Include the UUID-less path before, between and after known conflicts.
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [2, 0, 1],
      [1, 2, 0],
      [2, 1, 0]
    ]) {
      const disks = await configuredDiskUsages(
        {} as StackarrEnv,
        (paths) =>
          diskUsages(paths, (requested) => ({
            label: '/mnt/data',
            path: '/mnt/data',
            paths: [requested],
            filesystem: '/dev/fixture',
            mountPoint: '/mnt/data',
            ...(requested.endsWith('state') ? {} : { volumeId: requested.endsWith('-a') ? 'uuid-a' : 'uuid-b' }),
            status: 'available',
            freeSpace: 1024 ** 3,
            totalSpace: 2 * 1024 ** 3,
            usedPercent: 50
          })),
        async () => ({ roots: order.map((index) => roots[index]), issues: [] })
      );
      assert.equal(disks.length, 3);
      const rows = consumer === 'home' ? render(disks).rows : await renderDiskPage(disks);
      assert.equal(new Set(rows.map((row) => row.key)).size, 3);
      for (let i = 0; i < disks.length; i++) {
        const requested = disks[i].paths[0];
        assert.equal(disks[i].paths.length, 1);
        assert.equal(disks[i].associations?.length, 1);
        assert.ok(rows[i].key);
        if (keys.has(requested)) assert.equal(rows[i].key, keys.get(requested));
        keys.set(requested, rows[i].key);
      }
    }
  });

  test(`${consumer} keeps cloned UUID devices distinct with order-stable keys and correct capacity`, async () => {
    const roots: StorageAssociation[] = [
      { path: '/mnt/a/library', service: 'plex', reason: 'Library location', source: 'native-library' },
      { path: '/mnt/b/backup', service: 'backup', reason: 'Backup Root', source: 'configuration' }
    ];
    const disks = await configuredDiskUsages(
      {} as StackarrEnv,
      (paths) =>
        diskUsages(paths, (requested) => {
          const first = requested === '/mnt/a/library';
          return {
            label: first ? '/mnt/a' : '/mnt/b',
            path: first ? '/mnt/a' : '/mnt/b',
            paths: [requested],
            filesystem: first ? '/dev/fixture-a' : '/dev/fixture-b',
            mountPoint: first ? '/mnt/a' : '/mnt/b',
            volumeId: 'cloned-uuid',
            status: 'available',
            freeSpace: first ? 1024 ** 3 : 2 * 1024 ** 3,
            totalSpace: first ? 2 * 1024 ** 3 : 4 * 1024 ** 3,
            usedPercent: 50
          };
        }),
      async () => ({ roots, issues: [] })
    );
    assert.equal(disks.length, 2);
    const rows = consumer === 'home' ? render(disks).rows : await renderDiskPage(disks);
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((row) => row.key)).size, 2);
    assert.ok(rows.every((row) => row.key !== null));
    const ambiguous = disks.map((disk) => ({ ...disk, filesystem: '/dev/ambiguous-label' }));
    const ambiguousRows = consumer === 'home' ? render(ambiguous).rows : await renderDiskPage(ambiguous);
    assert.equal(new Set(ambiguousRows.map((row) => row.key)).size, 2, 'different proven mounts remain distinct');
    assert.match(text(rows), /plex: Library location/);
    assert.match(text(rows), /backup: Backup Root/);
    const reversed =
      consumer === 'home' ? render([...disks].reverse()).rows : await renderDiskPage([...disks].reverse());
    assert.deepEqual(
      reversed.map((row) => row.key),
      rows.map((row) => row.key).reverse()
    );
    if (consumer === 'home') {
      assert.equal(text(render(disks).summary), 'Total capacity6.00 GiBUsed3.00 GiBAvailable3.00 GiBMounted drives2');
    } else {
      assert.match(text(rows[0]), /2.00 GiB/);
      assert.match(text(rows[1]), /4.00 GiB/);
    }
  });
}

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
function render(disks: DiskUsage[]) {
  const tree = component.exports.StorageOverview({ metrics: { disks } });
  return {
    rows: elements(tree).filter((element) => element.props.className === 'diskRow'),
    summary: elements(tree).find((element) => element.props.className === 'storageSummary')!
  };
}
const roots: StorageAssociation[] = [
  { path: '/mnt/archive/backups', service: 'backup', reason: 'Backup Root', source: 'configuration' },
  { path: '/mnt/archive/library', service: 'plex', reason: 'Library location', source: 'native-library' }
];
function unavailable(requested: string): DiskUsage {
  return {
    label: '/mnt/archive',
    path: '/mnt/archive',
    paths: [requested],
    filesystem: null,
    mountPoint: null,
    freeSpace: null,
    totalSpace: null,
    usedPercent: null,
    status: requested.endsWith('backups') ? 'not-enrolled' : 'unmounted'
  };
}

test('home storage distinguishes unavailable sibling paths, ownership and status with stable unique keys', async () => {
  const disks = await configuredDiskUsages(
    {} as StackarrEnv,
    (paths) => diskUsages(paths, unavailable),
    async () => ({ roots, issues: [] })
  );
  const { rows } = render(disks);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.key)).size, 2);
  const backup = rows.find((row) => text(row).includes('/mnt/archive/backups'))!;
  const library = rows.find((row) => text(row).includes('/mnt/archive/library'))!;
  assert.ok(backup);
  assert.ok(library);
  assert.match(text(backup), /not-enrolled/);
  assert.match(text(backup), /backup: Backup Root/);
  assert.doesNotMatch(text(backup), /Verify host mount|unmounted/);
  assert.match(text(library), /unmounted/);
  assert.match(text(library), /plex: Library location/);
  assert.deepEqual(
    render([...disks].reverse()).rows.map((row) => row.key),
    rows.map((row) => row.key).reverse()
  );
});

test('home storage keeps mixed available and unavailable rows distinct and totals only verified capacity', async () => {
  const disks = await configuredDiskUsages(
    {} as StackarrEnv,
    (paths) =>
      diskUsages(paths, (requested) =>
        requested.endsWith('backups')
          ? unavailable(requested)
          : {
              label: '/mnt/archive',
              path: '/mnt/archive',
              paths: [requested],
              filesystem: '/dev/fixture',
              mountPoint: '/mnt/archive',
              volumeId: 'fixture-volume',
              freeSpace: 1024 ** 3,
              totalSpace: 2 * 1024 ** 3,
              usedPercent: 50,
              status: 'available'
            }
      ),
    async () => ({ roots, issues: [] })
  );
  const { rows, summary } = render(disks);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.key)).size, 2);
  const backup = rows.find((row) => text(row).includes('/mnt/archive/backups'))!;
  const library = rows.find((row) => text(row).includes('/mnt/archive/library'))!;
  assert.match(text(backup), /Capacity unavailable · not-enrolled/);
  assert.doesNotMatch(text(backup), /GiB/);
  assert.match(text(library), /1.00 GiB of 2.00 GiB used · 1.00 GiB available/);
  assert.match(text(library), /plex: Library location/);
  assert.match(text(library), /50%/);
  assert.equal(text(summary), 'Total capacity2.00 GiBUsed1.00 GiBAvailable1.00 GiBMounted drives1');
});

test('home storage retains requested paths and a neutral fallback when legacy rows lack associations', () => {
  const disk = unavailable('/mnt/archive/legacy');
  delete disk.status;
  const { rows } = render([disk]);
  assert.match(text(rows[0]), /probe-unavailable/);
  assert.match(text(rows[0]), /\/mnt\/archive\/legacy/);
  assert.doesNotMatch(text(rows[0]), /Verify host mount/);
});
