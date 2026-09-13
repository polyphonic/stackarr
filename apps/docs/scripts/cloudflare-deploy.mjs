import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment } from './cloudflare-env.mjs';

const preview = process.argv.includes('--preview');
const stage = preview ? 'preview' : 'production';
const built = JSON.parse(readFileSync(new URL('../dist/server/wrangler.json', import.meta.url), 'utf8'));
if (built.vars.DEPLOYMENT_ENV !== stage) throw new Error(`Build ${stage} before deploying`);
const values = loadEnvironment(stage);
const secrets = Object.fromEntries(Object.entries(values).filter(([name]) => !name.startsWith('NEXT_PUBLIC_')));
const directory = mkdtempSync(join(tmpdir(), 'docs-deploy-'));
try {
  const file = join(directory, 'secrets.json');
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  const args = ['exec', 'wrangler', ...(preview ? ['versions', 'upload'] : ['deploy']), '--secrets-file', file];
  if (process.argv.includes('--dry-run')) args.push('--dry-run');
  if (preview) {
    const alias =
      (process.env.WORKERS_CI_BRANCH || 'preview')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 40)
        .replace(/^-+|-+$/g, '') || 'preview';
    args.push('--preview-alias', alias);
  }
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
