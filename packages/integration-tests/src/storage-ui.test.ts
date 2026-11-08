import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const frontend = new URL('../../../apps/frontend/src/', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, frontend), 'utf8');

// Render the real component without loading its CSS module or a running installation.
const frontendRequire = createRequire(new URL('../package.json', frontend));
const componentCode = ts.transpileModule(
  source('components/MediaLocationSummary.tsx').replace(
    "import styles from './MediaLocationSummary.module.css';",
    'const styles = {};'
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }
).outputText;
const componentExports: Record<string, unknown> = {};
new Function('require', 'exports', componentCode)(frontendRequire, componentExports);
const { relativeMediaFolder, MediaLocationSummary } = componentExports as {
  relativeMediaFolder: (root: string, folder: string) => string | null;
  MediaLocationSummary: (props: Record<string, unknown>) => unknown;
};
const React = frontendRequire('react') as {
  createElement: (component: unknown, props: Record<string, unknown>) => unknown;
};
const { renderToStaticMarkup } = frontendRequire('react-dom/server') as {
  renderToStaticMarkup: (element: unknown) => string;
};
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(MediaLocationSummary, props));

test('folder preview distinguishes shared host folders, external downloads, app data, and Docker paths', () => {
  assert.equal(relativeMediaFolder('/mnt/media/', '/mnt/media/Downloads/'), 'Downloads');
  assert.equal(relativeMediaFolder('/mnt/media', '/mnt/medialib/Downloads'), null);
  assert.equal(relativeMediaFolder('/mnt/media', '/mnt/media'), '.');
  const html = render({
    media: '/mnt/media',
    downloads: '/mnt/media/Downloads',
    scratch: '/mnt/media/Downloads/transcodes',
    appData: '/ssd/app-data',
    shared: true
  });
  assert.match(html, /Movies/);
  assert.match(html, /TV Shows/);
  assert.match(html, /Downloads\/transcodes/);
  assert.match(html, /App data stays separate/);
  assert.match(html, /\/ssd\/app-data/);
  assert.match(html, /mounted logical volume/);
  assert.match(html, /A mirror is not a\s+backup/);
  assert.match(html, /Advanced: paths inside Docker/);
  assert.doesNotMatch(html, /Downloads are outside Media/);
  assert.doesNotMatch(html, /Outside Media/);
});

test('external downloads show conditional filesystem warning; legacy layout does not claim shared folders', () => {
  const separate = render({ media: '/mnt/media', downloads: '/ssd/downloads', shared: true });
  assert.match(separate, /Downloads are outside Media/);
  assert.match(separate, /different filesystems/);
  assert.match(separate, /Outside Media/);
  const legacy = render({ media: '/mnt/media', downloads: '/ssd/downloads', shared: false });
  assert.match(legacy, /Existing app paths/);
  assert.doesNotMatch(legacy, /\/data\/Movies/);
  assert.match(legacy, /Downloads are outside Media/);
  assert.match(legacy, /If the folders are on different filesystems, imports must copy files/);
  assert.match(legacy, /instead of hardlinking/);
  for (const shared of [true, false]) {
    for (const downloads of ['/mnt/media/Downloads', '/mnt/media', '']) {
      assert.doesNotMatch(render({ media: '/mnt/media', downloads, shared }), /Downloads are outside Media/);
    }
    assert.doesNotMatch(render({ media: '', downloads: '/ssd/downloads', shared }), /Downloads are outside Media/);
  }
  const oneFolder = render({
    media: '/mnt/media',
    downloads: '/mnt/media',
    appData: '/mnt/media/config',
    shared: true
  });
  assert.match(oneFolder, /App data location/);
  assert.doesNotMatch(oneFolder, /App data stays separate/);
  assert.doesNotMatch(oneFolder, /Downloads are outside Media/);
});

test('setup carries the selected layout without replacing a missing legacy value', () => {
  const page = source('app/setup/page.tsx');
  const wizard = source('components/SetupWizard.tsx');
  assert.match(page, /mediaPathLayout: env\.MEDIA_PATH_LAYOUT/);
  assert.match(wizard, /\.\.\.\(state\.mediaPathLayout \? \{ MEDIA_PATH_LAYOUT: state\.mediaPathLayout \} : \{\}\)/);
  const summary = source('components/MediaLocationSummary.tsx');
  assert.match(wizard, /<MediaLocationSummary/);
  assert.match(summary, /label: 'Movies', value: shared \? 'Movies'/);
  assert.match(summary, /Advanced: paths inside Docker/);
  assert.ok(wizard.indexOf('Downloads folder on host') < wizard.indexOf('<MediaLocationSummary'));
  assert.match(summary, /If the folders are on different filesystems, imports must copy files/);
});

test('settings retain independent host roots and explain layout without auto-conversion', () => {
  const settings = source('components/SettingsEditor.tsx');
  assert.match(settings, /label="Media folder on host"[\s\S]*?envValue\('MEDIA_ROOT'\)/);
  assert.match(settings, /label="Downloads folder on host"[\s\S]*?envValue\('DOWNLOADS_ROOT'\)/);
  assert.match(settings, /envValue\('MEDIA_PATH_LAYOUT'\) === 'shared'/);
  assert.match(settings, /does not migrate files or switch the library layout/);
  assert.ok(settings.indexOf('Downloads folder on host') < settings.indexOf('<MediaLocationSummary'));
  assert.match(settings, /onChange=\{\(value\) => updateEnv\('DOWNLOADS_ROOT', value\)\}/);
});

test('shared subfolder input renders and handles relative edits without rewriting outside paths', async () => {
  const pnpmModules = new URL('../../../node_modules/.pnpm/', import.meta.url);
  const jsdomPackage = readdirSync(pnpmModules).find((name) => name.startsWith('jsdom@29.'));
  assert.ok(jsdomPackage);
  const jsdomRequire = createRequire(new URL(`${jsdomPackage}/node_modules/jsdom/package.json`, pnpmModules));
  const { JSDOM } = jsdomRequire('jsdom');
  const dom = new JSDOM('<div id="root"></div>');
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = frontendRequire('react-dom/client');
  const { act } = frontendRequire('react');
  const code = ts.transpileModule(source('components/MediaSubfolderInput.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'react') return frontendRequire('react');
    if (id === './MediaLocationSummary') return { relativeMediaFolder };
    if (id === './PathPicker')
      return {
        PathInput: ({ value, onChange }: { value: string; onChange: (next: string) => void }) =>
          React.createElement('input', {
            value,
            onChange: (event: { target: { value: string } }) => onChange(event.target.value)
          })
      };
    return frontendRequire(id);
  }, exports);
  const { MediaSubfolderInput, resolveMediaSubfolder, rebaseMediaSubfolder } = exports as {
    MediaSubfolderInput: unknown;
    resolveMediaSubfolder: (root: string, value: string) => string | null;
    rebaseMediaSubfolder: (oldRoot: string, newRoot: string, folder: string) => string;
  };
  assert.equal(resolveMediaSubfolder('/media', '../escape'), null);
  assert.equal(resolveMediaSubfolder('/media', '/other'), null);
  assert.equal(resolveMediaSubfolder('/media', ''), null);
  assert.equal(resolveMediaSubfolder('/media', 'Music / Live'), '/media/Music / Live');
  assert.equal(rebaseMediaSubfolder('/media', '/new', '/media/Music / Live'), '/new/Music / Live');
  assert.equal(rebaseMediaSubfolder('/media', '/new', '/else/Music'), '/else/Music');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  let value = '/media/Music';
  const changes: string[] = [];
  const field = () =>
    React.createElement(MediaSubfolderInput, {
      label: 'Music',
      root: '/media',
      value,
      defaultFolder: 'Music',
      onChange: (next: string) => {
        changes.push(next);
        value = next;
        root.render(field());
      }
    });
  try {
    await act(() => {
      root.render(field());
    });
    const input = container.querySelector('input')!;
    assert.equal(input.value, 'Music');
    const nativeSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
    await act(() => {
      nativeSetter.call(input, 'Music / Live');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.deepEqual(changes, ['/media/Music / Live']);
    assert.equal(container.querySelector('input')!.value, 'Music / Live');
    await act(() => {
      nativeSetter.call(input, '../escape');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.deepEqual(changes, ['/media/Music / Live']);
    assert.match(container.textContent || '', /Enter a non-empty relative folder/);
    for (const invalid of ['/absolute', '']) {
      await act(() => {
        nativeSetter.call(input, invalid);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      assert.deepEqual(changes, ['/media/Music / Live']);
    }
    await act(() => {
      root.render(
        React.createElement(MediaSubfolderInput, {
          label: 'Music',
          root: '/media',
          value: '/other/Music',
          defaultFolder: 'Music',
          onChange: (next: string) => changes.push(next)
        })
      );
    });
    assert.match(container.textContent || '', /Advanced: Music outside Media/);
    assert.equal(container.querySelector('input')!.value, '/other/Music');
    assert.deepEqual(changes, ['/media/Music / Live']);
  } finally {
    await act(() => {
      root.unmount();
    });
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  }
});
