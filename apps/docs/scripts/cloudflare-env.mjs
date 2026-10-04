import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { config } from '@dotenvx/dotenvx';

export function loadEnvironment(stage) {
  if (!['production', 'preview'].includes(stage)) throw new Error('Invalid deployment environment');
  const keyName = `DOTENV_PRIVATE_KEY_${stage.toUpperCase()}`;
  const keyFile = new URL('../../../.env.keys', import.meta.url);
  const localKeys = existsSync(keyFile) ? parseEnv(readFileSync(keyFile, 'utf8')) : {};
  const privateKey = process.env[keyName] || localKeys[keyName];
  if (!privateKey) throw new Error(`Add ${keyName} to Cloudflare Build secrets`);
  const source = readFileSync(new URL(`../src/env/.env.${stage}`, import.meta.url), 'utf8');
  const entries = parseEnv(source);
  for (const [name, value] of Object.entries(entries)) {
    if (!name.startsWith('DOTENV_PUBLIC_KEY') && value && !value.startsWith('encrypted:')) {
      throw new Error(`Encrypt ${name} before deploying`);
    }
  }
  const result = config({
    envs: [{ type: 'env', value: source, privateKeyName: keyName }],
    processEnv: { [keyName]: privateKey },
    quiet: true,
    noOps: true
  });
  if (result.error) throw new Error(`Unable to decrypt ${stage} environment`);
  return Object.fromEntries(
    Object.keys(entries)
      .filter((name) => !name.startsWith('DOTENV_'))
      .map((name) => [name, result.parsed[name]])
  );
}
