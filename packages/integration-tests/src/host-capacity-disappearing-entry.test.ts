import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

for (const phase of ['before-stat', 'before-expired-cleanup']) {
  test(`storage responder survives client cleanup ${phase}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'capacity-race-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          `
        const assert = require('node:assert/strict');
        const fs = require('node:fs');
        const path = require('node:path');
        const crypto = require('node:crypto');
        const [root, script, phase] = process.argv.slice(1);
        const policy = path.join(root, 'storage-policy.json');
        fs.writeFileSync(policy, JSON.stringify({version: 1, roots: []}));
        const bridge = path.join(root, 'storage-bridge');
        fs.mkdirSync(bridge);
        const victim = path.join(bridge, '00000000000000000000000000000000.response');
        fs.writeFileSync(victim, '{}');
        if (phase === 'before-expired-cleanup') fs.utimesSync(victim, 0, 0);
        const nonce = 'ffffffffffffffffffffffffffffffff';
        const digest = crypto.createHash('sha256').update(fs.readFileSync(policy)).digest('hex');
        fs.writeFileSync(path.join(bridge, nonce + '.request'), JSON.stringify({nonce, digest, at: Date.now()}));
        const originalRead = fs.readdirSync;
        const originalStat = fs.lstatSync;
        let removed = false;
        if (phase === 'before-stat') {
          fs.readdirSync = function(target, ...args) {
            const names = originalRead.call(this, target, ...args);
            if (target === bridge && !removed) { fs.unlinkSync(victim); removed = true; }
            return names;
          };
        } else {
          fs.lstatSync = function(target, ...args) {
            const value = originalStat.call(this, target, ...args);
            if (target === victim && !removed) { fs.unlinkSync(victim); removed = true; }
            return value;
          };
        }
        const control = require(script);
        assert.doesNotThrow(() => control.respond(policy, () => {}));
        assert.equal(removed, true, 'fixture must exercise the cleanup race');
        const reply = JSON.parse(fs.readFileSync(path.join(bridge, nonce + '.response'), 'utf8'));
        assert.equal(reply.ready, true);
        assert.equal(reply.nonce, nonce);
        assert.equal(reply.digest, digest);
        assert.equal(fs.existsSync(path.join(bridge, nonce + '.request')), false);
      `,
          root,
          path.resolve('stackarr/scripts/storage-control.cjs'),
          phase
        ],
        {
          encoding: 'utf8',
          timeout: 15000
        }
      );
      assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
