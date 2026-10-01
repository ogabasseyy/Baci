import assert from 'node:assert/strict';
import test from 'node:test';

import { generateTask9BootstrapBundle } from './task9-bootstrap-bundle.mjs';

test('refuses transaction identifiers with underscore or more than 63 characters', () => {
  for (const transactionId of ['task9_transaction', `t${'a'.repeat(63)}`]) {
    assert.throws(
      () => generateTask9BootstrapBundle({ transactionId }),
      /transaction id/
    );
  }
});
