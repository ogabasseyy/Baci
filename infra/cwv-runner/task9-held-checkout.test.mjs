import assert from 'node:assert/strict';
import { fstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { withHeldTask9Checkout } from './task9-held-checkout.mjs';

test('holds and revalidates the checkout directory identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'task9-held-checkout-'));
  try {
    const result = withHeldTask9Checkout(root, realpathSync(root), (handle) => {
      assert.doesNotThrow(() => fstatSync(handle.fd));
      assert.doesNotThrow(handle.guard);
      return 'ok';
    });
    assert.equal(result, 'ok');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
