import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBinaryBytes } from '../../../apps/frontend/src/lib/formatBinaryBytes';

test('binary storage formatter labels 1024-based quantities as IEC units', () => {
  assert.equal(formatBinaryBytes(1024), '1.00 KiB');
  assert.equal(formatBinaryBytes(1024 ** 3), '1.00 GiB');
  assert.equal(formatBinaryBytes(500 * 1024 ** 3), '500 GiB');
  assert.equal(formatBinaryBytes(0), '0 B');
});
