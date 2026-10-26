import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createSessionVault } from './session-vault.ts';

test('vault authenticates ciphertext against connection, actor and key rotation metadata', () => {
  const old = randomBytes(32);
  const current = randomBytes(32);
  const first = createSessionVault({
    activeKeyId: 'old',
    keys: new Map([['old', old]]),
  });
  const binding = { connectionId: 'connection-a', actorUserId: 'owner-a' };
  const sealed = first.seal(
    {
      accessToken: 'private-access',
      refreshToken: 'private-refresh',
      expiresAt: 12345,
    },
    binding
  );
  assert(!JSON.stringify(sealed).includes('private-'));
  const rotated = createSessionVault({
    activeKeyId: 'new',
    keys: new Map([
      ['old', old],
      ['new', current],
    ]),
  });
  assert.equal(rotated.open(sealed, binding).accessToken, 'private-access');
  assert.equal(
    rotated.seal(rotated.open(sealed, binding), binding).keyId,
    'new'
  );
  for (const bad of [
    { ...binding, connectionId: 'other' },
    { ...binding, actorUserId: 'other' },
  ])
    assert.throws(() => rotated.open(sealed, bad));
  assert.throws(() =>
    rotated.open(
      { ...sealed, tag: randomBytes(16).toString('base64url') },
      binding
    )
  );
  assert.throws(() => rotated.open({ ...sealed, keyId: 'new' }, binding));
});
