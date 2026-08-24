import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('app cards reserve a top-aligned right column for every action', async () => {
  const [component, styles] = await Promise.all([
    readFile(path.join(repoRoot, 'apps/frontend/src/components/ServiceDirectory.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'apps/frontend/src/components/ServiceDirectory.module.css'), 'utf8')
  ]);

  assert.match(styles, /\.card \{[\s\S]*?grid-template-columns: 46px minmax\(0, 1fr\) minmax\(104px, auto\);/);
  assert.match(styles, /\.cardActions \{[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 1;[\s\S]*?display: grid;/);
  assert.match(styles, /\.openButton \{[\s\S]*?width: 100%;[\s\S]*?margin-right: 0;/);
  assert.match(styles, /\.pinButton \{[\s\S]*?justify-self: end;/);

  const actions = component.slice(component.indexOf('<div className={styles.cardActions}>'));
  assert.ok(actions.indexOf('styles.openButton') < actions.indexOf('styles.pinButton'));
  assert.ok(actions.indexOf('styles.pinButton') < actions.indexOf('<ServiceSettingsModal'));
});
