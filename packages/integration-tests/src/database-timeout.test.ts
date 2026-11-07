import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runPsql } from '../../core/src/database';

test('runPsql aborts and throws ETIMEDOUT when query hangs beyond timeout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-psql-timeout-'));
  const originalPath = process.env.PATH;
  const mockPsql = path.join(dir, 'psql');

  fs.writeFileSync(mockPsql, '#!/bin/sh\nsleep 5\necho "done"\n', { mode: 0o755 });

  process.env.PATH = `${dir}:${originalPath}`;
  process.env.STACKARR_DATABASE_URL = 'postgres://user:pass@127.0.0.1:5432/db';

  const start = Date.now();
  try {
    assert.throws(
      () => {
        runPsql('SELECT 1', {}, true, 'main', 200);
      },
      (error: unknown) => {
        const err = error as NodeJS.ErrnoException;
        return Boolean(err && (err.code === 'ETIMEDOUT' || /timed? ?out/i.test(err.message)));
      }
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `Expected timeout in <2000ms, elapsed: ${elapsed}ms`);
  } finally {
    process.env.PATH = originalPath;
    delete process.env.STACKARR_DATABASE_URL;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
