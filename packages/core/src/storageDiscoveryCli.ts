#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import type { StackarrEnv } from './env';
import { discoverHostServiceStorage } from './serviceStorage';

// No paths or enrollment instructions are accepted from the caller.
async function main() {
  if (process.argv.length !== 2 || ['docker', 'docker-updater'].includes(process.env.STACKARR_RUNTIME ?? '')) {
    throw new Error('invalid-discovery-context');
  }
  const env = JSON.parse(fs.readFileSync(0, 'utf8')) as StackarrEnv;
  if (
    !env ||
    Array.isArray(env) ||
    Object.values(env).some((v) => typeof v !== 'string') ||
    !env.STATE_ROOT?.startsWith('/') ||
    !env.APP_ROOT?.startsWith('/') ||
    !env.CONFIG_ROOT?.startsWith('/') ||
    path.join(env.STATE_ROOT, 'storage-policy.json') !== process.env.STACKARR_CAPACITY_POLICY
  ) {
    throw new Error('missing-authoritative-roots');
  }
  const { roots, issues } = await discoverHostServiceStorage(env);
  process.stdout.write(`${JSON.stringify({ roots, issues })}\n`);
}
main().catch(() => {
  process.stderr.write('storage-discovery-unavailable\n');
  process.exitCode = 1;
});
