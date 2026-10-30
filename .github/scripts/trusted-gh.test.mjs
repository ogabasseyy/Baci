import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTrustedGhBinary } from './trusted-gh.mjs';

const good = (overrides = {}) => ({ isFile: () => true, isSymbolicLink: () => false, uid: 1001, mode: 0o100755, ...overrides });

test('accepts only the private executable owned by the expected runner UID', () => {
  assert.equal(validateTrustedGhBinary('/tmp/gh', { lstat: () => good() }), '/tmp/gh');
  assert.throws(() => validateTrustedGhBinary('/tmp/gh', { lstat: () => good({ isSymbolicLink: () => true }) }), /identity or permissions/);
  assert.throws(() => validateTrustedGhBinary('/tmp/gh', { lstat: () => good({ uid: 501 }) }), /identity or permissions/);
  assert.throws(() => validateTrustedGhBinary('/tmp/gh', { lstat: () => good({ mode: 0o100777 }) }), /identity or permissions/);
  assert.throws(() => validateTrustedGhBinary('/tmp/gh', { lstat: () => good({ mode: 0o100644 }) }), /identity or permissions/);
  assert.throws(() => validateTrustedGhBinary('/tmp/gh', { lstat: () => good({ isFile: () => false }) }), /identity or permissions/);
});

test('fails closed when the pinned CLI is missing or unreadable', () => {
  assert.throws(() => validateTrustedGhBinary('/tmp/missing', { lstat: () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } }), /unavailable/);
});
