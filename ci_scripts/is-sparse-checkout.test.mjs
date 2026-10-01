import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./is-sparse-checkout.sh', import.meta.url),
  'utf8'
);

test('detects sparse checkout via core.sparseCheckout', () => {
  assert.match(source, /core\.sparseCheckout/);
  assert.match(source, /git rev-parse --is-inside-work-tree/);
});
