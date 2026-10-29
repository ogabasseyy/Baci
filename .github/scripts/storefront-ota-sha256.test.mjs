import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from './storefront-ota-sha256.mjs';

test('computes the standard SHA-256 digest for text and bytes', () => {
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(sha256('abc'), expected);
  assert.equal(sha256(Buffer.from('abc')), expected);
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
