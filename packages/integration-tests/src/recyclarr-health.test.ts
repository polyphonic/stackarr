import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

test('Recyclarr probes the configured Compose project and executes only --version', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-recyclarr-health-'));
  try {
    const docker = path.join(root, 'docker');
    const calls = path.join(root, 'calls.jsonl');
    await writeFile(
      docker,
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (args[0] === 'ps') console.log(JSON.stringify({ID:'abc123', Names:'recyclarr', State:'running', Status:'Up'}));
else if (args[0] === 'inspect') console.log(JSON.stringify([{Id:'abc123', Name:'/recyclarr', Config:{Labels:{'com.docker.compose.project':'custom-stack','com.docker.compose.service':'recyclarr'}}, State:{Running:true}, HostConfig:{RestartPolicy:{Name:'unless-stopped'}}}]));
else if (args[0] === 'exec' && JSON.stringify(args.slice(1)) === JSON.stringify(['abc123','recyclarr','--version'])) console.log('v8.8.1');
else process.exit(1);
`
    );
    await chmod(docker, 0o755);
    const script = `
const { writeEnvConfig } = await import('./packages/core/src/env.ts');
const { getAppHealthSummaryAction } = await import('./packages/core/src/actions/health.ts');
writeEnvConfig({ENABLE_RECYCLARR:'true', STACKARR_COMPOSE_PROJECT_NAME:'custom-stack'});
const result = await getAppHealthSummaryAction();
console.log(JSON.stringify(result.checks.find(check => check.service === 'recyclarr')));
`;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        path.join(repo, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs'),
        '--input-type=module',
        '-e',
        script
      ],
      {
        cwd: repo,
        timeout: 30000,
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          STACKARR_DATABASE_URL: '',
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db'),
          STACKARR_COMPOSE_PROJECT_NAME: 'custom-stack',
          COMPOSE_PROJECT_NAME: 'unrelated-project'
        }
      }
    );
    assert.equal(JSON.parse(stdout).status, 'healthy', stdout);
    const invocations = (await readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.ok(
      invocations.some((args) => JSON.stringify(args) === JSON.stringify(['exec', 'abc123', 'recyclarr', '--version']))
    );
    assert.ok(invocations.every((args) => !args.includes('sync')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
