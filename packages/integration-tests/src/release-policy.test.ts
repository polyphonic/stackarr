import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = path.join(root, '.github/workflows/release.yml');
const script = path.join(root, 'stackarr/scripts/verify-release-manifests.sh');
const revision = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;

test('release metadata intentionally moves latest for prereleases without altering stable convenience tags', async () => {
  const text = await readFile(workflow, 'utf8');
  assert.match(text, /latest=false/);
  assert.match(text, /type=raw,value=latest\s*\n/);
  assert.doesNotMatch(text, /type=raw,value=latest,enable=/);
  assert.match(text, /type=raw,value=alpha,enable=\$\{\{ contains\(/);
  assert.match(text, /type=raw,value=beta,enable=\$\{\{ contains\(/);
  assert.match(text, /type=sha,format=long,prefix=sha-/);
  assert.match(text, /type=semver,pattern=\{\{version\}\}/);
  assert.match(text, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\},enable=\$\{\{ !contains\(/);
  assert.match(text, /type=semver,pattern=\{\{major\}\},enable=\$\{\{ !contains\(/);
  assert.match(text, /bash stackarr\/scripts\/verify-release-manifests\.sh/);
});

// Mock the registry lookup, not the verifier: exercises digest and platform checks for each tag.
test('published tag verification accepts matching alpha tags and rejects drift or missing platforms', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'stackarr-release-'));
  try {
    const docker = path.join(dir, 'docker');
    await writeFile(
      docker,
      `#!/usr/bin/env bash
ref=''
for arg in "$@"; do if [[ "$arg" == *'/polyphonic/stackarr:'* ]]; then ref="$arg"; fi; done
if [[ "$*" == *--format* ]]; then printf '%s\\n' "$ref" >> "$CALLS"; fi
if [[ "\${MISMATCH_LATEST:-}" == yes && "$ref" == *:latest && "$*" == *--format* ]]; then printf 'sha256:%064d\\n' 0; exit; fi
if [[ "$*" == *--format* ]]; then printf '${digest}\\n'; else
  if [[ "\${MISSING_ARM:-}" == yes && "$ref" == *:latest ]]; then printf '{"manifests":[{"platform":{"os":"linux","architecture":"amd64"}}]}\\n';
  else printf '{"manifests":[{"platform":{"os":"linux","architecture":"amd64"}},{"platform":{"os":"linux","architecture":"arm64"}}]}\\n'; fi
fi
`,
      { mode: 0o755 }
    );
    const output = path.join(dir, 'output');
    const calls = path.join(dir, 'calls');
    const run = (extra: Record<string, string> = {}, channel = 'alpha', version = '0.3.0-alpha.22') =>
      spawnSync('bash', [script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_OUTPUT: output,
          CALLS: calls,
          VERSION: version,
          REVISION: revision,
          CHANNEL: channel,
          ...extra
        }
      });
    assert.equal(run().status, 0);
    assert.match(await readFile(output, 'utf8'), new RegExp(`hub_digest=${digest}\\nghcr_digest=${digest}`));
    const alphaCalls = await readFile(calls, 'utf8');
    for (const registry of ['docker.io', 'ghcr.io']) {
      for (const tag of ['0.3.0-alpha.22', `sha-${revision}`, 'latest', 'alpha']) {
        assert.match(alphaCalls, new RegExp(`${registry}/polyphonic/stackarr:${tag.replaceAll('.', '\\.')}`));
      }
    }
    assert.notEqual(run({ MISMATCH_LATEST: 'yes' }).status, 0);
    assert.notEqual(run({ MISSING_ARM: 'yes' }).status, 0);
    assert.equal(run({}, 'stable', '1.2.3').status, 0);
    const stableCalls = await readFile(calls, 'utf8');
    assert.match(stableCalls, /docker.io\/polyphonic\/stackarr:1\.2\n/);
    assert.match(stableCalls, /ghcr.io\/polyphonic\/stackarr:1\n/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
