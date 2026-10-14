import { cartSessionStorage } from '@/lib/cart/session-storage';
import {
  cartBindingMatchesCurrentDevice,
  readSharedCartOrderProof,
} from './orders-cart-binding';

jest.mock('@/lib/cart/session-storage', () => ({
  cartSessionStorage: {
    get: jest.fn(),
    getOwnerSubject: jest.fn(),
    getSession: jest.fn(),
  },
}));

const ref = { merchantId: 'merchant-a', cartId: 'cart-a' };
const binding = {
  cart_id: 'cart-a',
  checkout_session_id: 'session',
  checkout_generation: 1,
  cart_version: 2,
};
it('refuses a legacy downgrade after the device acquired canonical cart ownership', () => {
  expect(cartBindingMatchesCurrentDevice(undefined, ref, 'merchant-a')).toBe(
    false
  );
  expect(cartBindingMatchesCurrentDevice(binding, ref, 'merchant-b')).toBe(
    false
  );
  expect(
    cartBindingMatchesCurrentDevice(
      { ...binding, cart_id: 'other' },
      ref,
      'merchant-a'
    )
  ).toBe(false);
  expect(cartBindingMatchesCurrentDevice(binding, ref, 'merchant-a')).toBe(
    true
  );
});
it('preserves ordinary guest legacy checkout when no canonical cart was acquired', () => {
  expect(
    cartBindingMatchesCurrentDevice(undefined, undefined, 'merchant-a')
  ).toBe(true);
});

it('attaches only the device proof for the bound cart', async () => {
  const merchantId = '11111111-1111-4111-8111-111111111111';
  const cartId = '22222222-2222-4222-8222-222222222222';
  const payload = {
    cartId,
    exp: 9999999999,
    merchantId,
    principalId: 'guest-1',
    scope: 'session',
  };
  const proof = `cp1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  const getSession = jest.mocked(cartSessionStorage.getSession);
  getSession?.mockResolvedValue({ ownerSubject: undefined, proof } as never);

  await expect(
    readSharedCartOrderProof(
      { ...binding, cart_id: cartId },
      merchantId,
      undefined
    )
  ).resolves.toBe(proof);
  await expect(
    readSharedCartOrderProof(
      { ...binding, cart_id: '33333333-3333-4333-8333-333333333333' },
      merchantId,
      undefined
    )
  ).resolves.toBeUndefined();
  await expect(
    readSharedCartOrderProof(undefined, merchantId, undefined)
  ).resolves.toBeUndefined();
});
