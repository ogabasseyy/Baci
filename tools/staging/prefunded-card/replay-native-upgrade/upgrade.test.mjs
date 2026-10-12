import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareUpgrade } from './upgrade.mjs';

test('refuses absent or changed actual installed predecessor bytes before preparing configuration', () => {
  for (const predecessorBytes of [undefined, {}, {
    bundle: Buffer.from('not the installed factory'), daemon: Buffer.from('not installed daemon'),
    config: Buffer.from('not installed configuration'), private: Buffer.from('not installed private configuration'),
  }]) {
    assert.throws(() => prepareUpgrade({ predecessorBytes, artifact: {} }), /Actual predecessor/);
  }
});

test('does not accept caller-selected predecessor pins, role overrides or deadline extensions', () => {
  assert.throws(() => prepareUpgrade({ predecessorBytes: {}, artifact: {},
    predecessorPins: {}, expiresAt: '2099-01-01T00:00:00Z', role: 'service_role' }), /Upgrade input/);
});
