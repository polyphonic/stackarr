import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../../stackarr/scripts/release-target.cjs', import.meta.url));

test('release-note command is idempotent, preserves manual prose and rejects ambiguous markers', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const command = workflow.match(/          node <<'NODE'\n([\s\S]+?)          NODE\n/)?.[1];
  assert.ok(command);
  const start = '<!-- stackarr-container-images:start -->';
  const end = '<!-- stackarr-container-images:end -->';
  const block = `${start}\n## Container images\nnew digest\n${end}`;
  fs.writeFileSync(path.join(root, 'image-notes.md'), block);
  const run = (previous: string) => {
    fs.writeFileSync(path.join(root, 'current-notes.md'), previous);
    return spawnSync(process.execPath, ['-e', command], { cwd: root, encoding: 'utf8' });
  };
  const output = () => fs.readFileSync(path.join(root, 'release-notes.md'), 'utf8');
  assert.equal(run('# Manual notes\n').status, 0);
  const first = output();
  assert.equal(run(first).status, 0);
  assert.equal(output(), first);
  assert.equal(run(`# Before\n${start}\nold digest\n${end}\n# After\n`).status, 0);
  assert.equal(output(), `# Before\n${block}\n# After\n`);
  for (const bad of [start, end, `${end}\n${start}`, `${block}\n${block}`]) assert.notEqual(run(bad).status, 0);
});

function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-target-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const env = {
    ...process.env,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    GITHUB_OUTPUT: path.join(root, 'output'),
    GITHUB_REPOSITORY: 'example/project',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/production',
    PUBLISH_TAG: 'v1.2.3-alpha.1',
    PUBLISH_REVISION: '',
    GITHUB_SHA: '',
    FIXTURE_RELEASE: JSON.stringify({
      tagName: 'v1.2.3-alpha.1',
      isDraft: false,
      isPrerelease: true,
      publishedAt: '2026-01-01T00:00:00Z'
    })
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=production');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(root, '.release-please-manifest.json'), '{".":"1.2.3-alpha.1"}');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.2.3-alpha.1"}');
  git('add', '.');
  git('commit', '-m', 'chore: fixture release');
  env.PUBLISH_REVISION = git('rev-parse', 'HEAD');
  git('tag', env.PUBLISH_TAG);
  fs.writeFileSync(path.join(root, 'workflow.txt'), 'recovery support');
  git('add', 'workflow.txt');
  git('commit', '-m', 'ci: fixture recovery workflow');
  env.GITHUB_SHA = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s' "$FIXTURE_RELEASE"\n`, { mode: 0o755 });
  return {
    root,
    env,
    git,
    run: () => spawnSync(process.execPath, [script], { cwd: root, env, encoding: 'utf8' }),
    output: () => fs.readFileSync(env.GITHUB_OUTPUT, 'utf8')
  };
}

test('publication recovery selects the existing released commit, not the dispatch commit', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.output(), `revision=${f.env.PUBLISH_REVISION}\ntag_name=v1.2.3-alpha.1\nrecover=true\n`);
  assert.notEqual(f.env.PUBLISH_REVISION, f.env.GITHUB_SHA);
});

test('ordinary production runs retain the verified workflow revision', (t) => {
  const f = fixture(t);
  f.env.PUBLISH_TAG = '';
  f.env.PUBLISH_REVISION = '';
  f.env.GITHUB_EVENT_NAME = 'push';
  assert.equal(f.run().status, 0);
  assert.equal(f.output(), `revision=${f.env.GITHUB_SHA}\ntag_name=\nrecover=false\n`);
});

for (const [name, change] of [
  [
    'another branch',
    (f) => {
      f.env.GITHUB_REF = 'refs/heads/preview';
    }
  ],
  [
    'non-dispatched recovery',
    (f) => {
      f.env.GITHUB_EVENT_NAME = 'push';
    }
  ],
  [
    'malformed tag',
    (f) => {
      f.env.PUBLISH_TAG = '../v1.2.3-alpha.1';
    }
  ],
  [
    'missing revision',
    (f) => {
      f.env.PUBLISH_REVISION = '';
    }
  ],
  [
    'missing tag',
    (f) => {
      f.env.PUBLISH_TAG = '';
    }
  ],
  [
    'wrong tag commit',
    (f) => {
      f.env.PUBLISH_REVISION = f.env.GITHUB_SHA;
    }
  ],
  [
    'wrong workflow checkout',
    (f) => {
      f.env.GITHUB_SHA = f.env.PUBLISH_REVISION;
    }
  ],
  [
    'old product version',
    (f) => {
      fs.writeFileSync(path.join(f.root, 'package.json'), '{"version":"1.2.3-alpha.2"}');
    }
  ],
  [
    'draft release',
    (f) => {
      f.env.FIXTURE_RELEASE = JSON.stringify({
        tagName: f.env.PUBLISH_TAG,
        isDraft: true,
        isPrerelease: true,
        publishedAt: '2026-01-01T00:00:00Z'
      });
    }
  ],
  [
    'absent release',
    (f) => {
      f.env.FIXTURE_RELEASE = '{}';
    }
  ],
  [
    'wrong release channel',
    (f) => {
      f.env.FIXTURE_RELEASE = JSON.stringify({
        tagName: f.env.PUBLISH_TAG,
        isDraft: false,
        isPrerelease: false,
        publishedAt: '2026-01-01T00:00:00Z'
      });
    }
  ],
  [
    'tag outside production ancestry',
    (f) => {
      f.git('checkout', '--orphan', 'foreign');
      f.git('commit', '-m', 'chore: unrelated fixture');
      f.env.PUBLISH_REVISION = f.git('rev-parse', 'HEAD');
      f.git('tag', '-f', f.env.PUBLISH_TAG);
      f.git('checkout', 'production');
    }
  ]
] as const satisfies ReadonlyArray<readonly [string, (f: ReturnType<typeof fixture>) => void]>) {
  test(`publication recovery rejects ${name} without publication outputs`, (t) => {
    const f = fixture(t);
    change(f);
    assert.notEqual(f.run().status, 0);
    assert.equal(fs.existsSync(f.env.GITHUB_OUTPUT), false);
  });
}
