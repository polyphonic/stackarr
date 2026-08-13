import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('confirmed MCP volume cleanup is bound to reviewed volume names', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-docker-cleanup-'));
  const docker = path.join(root, 'docker');
  const argsFile = path.join(root, 'docker-args');
  const originalPath = process.env.PATH;

  try {
    await writeFile(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$STACKARR_DOCKER_ARGS_FILE"\n');
    await chmod(docker, 0o755);
    process.env.PATH = `${root}:${originalPath ?? ''}`;
    process.env.STACKARR_DOCKER_ARGS_FILE = argsFile;

    const { manageDockerResourceAction } = await import('../../core/src/index.ts');
    await manageDockerResourceAction({
      kind: 'volume',
      action: 'remove',
      id: 'stackarr_tracearr-timescale-data',
      confirmDangerous: true,
      reason: 'This exact detached Tracearr volume was reviewed and confirmed obsolete.'
    });

    assert.equal(await readFile(argsFile, 'utf8'), 'volume rm stackarr_tracearr-timescale-data\n');
    await assert.rejects(
      manageDockerResourceAction({
        kind: 'volume',
        action: 'pruneUnused',
        confirmDangerous: true,
        reason: 'The unused volume inventory was reviewed.'
      }),
      /Remove each reviewed volume by exact name/
    );
  } finally {
    process.env.PATH = originalPath;
    delete process.env.STACKARR_DOCKER_ARGS_FILE;
    await rm(root, { recursive: true, force: true });
  }
});
