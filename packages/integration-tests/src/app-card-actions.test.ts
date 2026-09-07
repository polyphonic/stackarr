import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ServiceConfigModel } from '@stackarr/core';
import { valuesFromConfig } from '../../../apps/frontend/src/lib/serviceConfigDraft';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('app cards keep Open top-right and reserve a stable footer action row', async () => {
  const [component, styles] = await Promise.all([
    readFile(path.join(repoRoot, 'apps/frontend/src/components/ServiceDirectory.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'apps/frontend/src/components/ServiceDirectory.module.css'), 'utf8')
  ]);

  assert.match(styles, /\.card \{[\s\S]*?grid-template-columns: 46px minmax\(0, 1fr\) minmax\(104px, auto\);/);
  assert.match(styles, /\.openButton \{[\s\S]*?grid-row: 1;[\s\S]*?grid-column: 3;[\s\S]*?width: 100%;/);
  assert.match(
    styles,
    /\.cardActions \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?display: flex;[\s\S]*?justify-content: flex-end;/
  );

  const openAction = component.indexOf('className={styles.openButton}');
  const footerActions = component.indexOf('className={styles.cardActions}');
  const footer = component.slice(footerActions);
  assert.ok(openAction > 0 && openAction < footerActions);
  assert.ok(footer.indexOf('styles.pinButton') < footer.indexOf('<ServiceSettingsModal'));
});

test('Add Maintainerr enables it in the saved draft while Settings preserves disabled values', () => {
  const config = {
    service: { name: 'maintainerr', mode: 'disabled' },
    groups: [
      {
        title: 'Maintainerr',
        fields: [
          {
            id: 'enableMaintainerr',
            type: 'checkbox',
            source: { source: 'env', key: 'ENABLE_MAINTAINERR' },
            value: false
          },
          {
            id: 'maintainerrGithubToken',
            type: 'password',
            source: { source: 'env', key: 'MAINTAINERR_GITHUB_TOKEN' },
            secret: true,
            value: 'redacted'
          }
        ]
      }
    ]
  } as ServiceConfigModel;
  assert.equal(valuesFromConfig(config, true).enableMaintainerr, true);
  assert.equal(valuesFromConfig(config).enableMaintainerr, false);
  assert.equal(valuesFromConfig(config, true).maintainerrGithubToken, '');
  assert.equal(config.groups[0].fields[0].value, false);
});
