import { readOwnedCartProof } from './owned-session';

const merchant = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';

const makeProof = (changes: Record<string, unknown> = {}) =>
  `cp1.${Buffer.from(
    JSON.stringify({
      merchantId: merchant,
      principalId: 'guest-1',
      scope: 'session',
      cartId,
      exp: 9999999999,
      ...changes,
    })
  ).toString('base64url')}.signature`;

it('returns null when no session is stored', async () => {
  const storage = {
    get: jest.fn(),
    getSession: jest.fn().mockResolvedValue(null),
  };
  await expect(
    readOwnedCartProof(storage as never, merchant, 'user-1')
  ).resolves.toBeNull();
});

it('returns the stored proof for the owning subject', async () => {
  const value = makeProof();
  const storage = {
    get: jest.fn(),
    getSession: jest
      .fn()
      .mockResolvedValue({ proof: value, ownerSubject: 'user-1' }),
  };
  await expect(
    readOwnedCartProof(storage as never, merchant, 'user-1')
  ).resolves.toBe(value);
});

it('rejects a proof owned by another subject', async () => {
  const storage = {
    get: jest.fn(),
    getSession: jest
      .fn()
      .mockResolvedValue({ proof: makeProof(), ownerSubject: 'user-2' }),
  };
  await expect(
    readOwnedCartProof(storage as never, merchant, 'user-1')
  ).rejects.toMatchObject({ code: 'session_changed' });
});

it('rejects an ownerless record whose actor is a linked customer device', async () => {
  const storage = {
    get: jest.fn(),
    getSession: jest.fn().mockResolvedValue({
      proof: makeProof({ principalId: 'customer-device:device-9' }),
      ownerSubject: null,
    }),
  };
  await expect(
    readOwnedCartProof(storage as never, merchant, undefined)
  ).rejects.toMatchObject({ code: 'session_changed' });
});

it('falls back to legacy get/getOwnerSubject storage', async () => {
  const value = makeProof();
  const storage = {
    get: jest.fn().mockResolvedValue(value),
    getOwnerSubject: jest.fn().mockResolvedValue('user-1'),
  };
  await expect(
    readOwnedCartProof(storage as never, merchant, 'user-1')
  ).resolves.toBe(value);
});
