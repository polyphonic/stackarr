import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('Connect uses HeroUI chips and Enter-to-publish for the Cloudflare email allowlist', async () => {
  const [editor, allowlist, ui] = await Promise.all([
    readFile(path.join(repoRoot, 'apps/frontend/src/components/SettingsEditor.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'apps/frontend/src/components/CloudflareEmailAllowlist.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'packages/ui/src/index.tsx'), 'utf8')
  ]);

  assert.match(ui, /export \{ Chip \} from '@heroui\/react\/chip'/);
  assert.match(ui, /export \{ CloseButton \} from '@heroui\/react\/close-button'/);
  assert.match(editor, /<CloudflareEmailAllowlist/);
  assert.doesNotMatch(editor, /label="Allowed Emails"/);
  assert.match(allowlist, /<Chip[\s\S]*<CloseButton/);
  assert.match(allowlist, /event\.key !== 'Enter'/);
  assert.match(allowlist, /\/api\/v1\/cloudflare\/access/);
  assert.match(allowlist, /method: 'PUT'/);
  assert.match(allowlist, /onPublished\(body\.allowedEmails\)/);
});
