import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

for (const mode of ['managed', 'external', 'independent']) {
  test(`${mode} service apply honors database ownership before lifecycle writes`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'stackarr-endpoint-apply-'));
    try {
      await mkdir(path.join(root, 'scripts'));
      await mkdir(path.join(root, 'lib'));
      const script = path.join(root, 'scripts/service-apply.sh');
      await writeFile(script, await readFile(new URL('../../../stackarr/scripts/service-apply.sh', import.meta.url)));
      await writeFile(
        path.join(root, 'lib/common.sh'),
        `
print_header() { :; }
load_env() { :; }
write_compose_env_file() { echo snapshot-write; }
ensure_docker_runtime() { :; }
database_required() { return 1; }
compose_profile_args() { printf '%s\\n' --profile immich --profile youtarr; }
optional_service_enabled() { [[ "\${TEST_DISABLED:-false}" != true ]]; }
ensure_dir() { :; }
stackarr_compose() { echo "compose $*"; }
ok() { echo "$*"; }
fail() { echo "$*"; exit 1; }
`
      );
      const env = {
        ...process.env,
        POSTGRES_DEPLOYMENT_MODE: mode,
        REDIS_DEPLOYMENT_MODE: mode,
        YOUTARR_DATABASE_DEPLOYMENT_MODE: mode,
        YOUTARR_OUTPUT_ROOT: root,
        YOUTARR_CONFIG_ROOT: root,
        YOUTARR_JOBS_ROOT: root,
        YOUTARR_IMAGES_ROOT: root
      };
      for (const app of ['immich', 'romm', 'tracearr', 'youtarr']) {
        const { stdout } = await execFile('bash', [script, 'apply', app], { env });
        assert.match(stdout, new RegExp(`--no-deps ${app}`));
        const dependency = app === 'youtarr' ? 'youtarr-db' : 'redis';
        assert.equal(new RegExp(`compose .*up .* ${dependency}\\n`).test(stdout), mode === 'managed');
      }
      if (mode !== 'managed') {
        for (const service of ['database', 'redis', 'youtarr-db']) {
          await assert.rejects(execFile('bash', [script, 'apply', service], { env }), (error: unknown) => {
            const failure = error as { stdout: string };
            assert.match(failure.stdout, /externally managed/);
            assert.doesNotMatch(failure.stdout, /snapshot-write|compose /);
            return true;
          });
        }
        const disabled = await execFile('bash', [script, 'apply', 'youtarr'], {
          env: { ...env, TEST_DISABLED: 'true' }
        });
        assert.doesNotMatch(disabled.stdout, /rm .*youtarr-db/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
