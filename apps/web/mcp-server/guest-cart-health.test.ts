import { expect, it } from 'vitest';
import {
  type GuestCartStoreLike,
  describeGuestCartStoreHealth,
} from './guest-cart-health';

const healthy = { lastStorageErrorCode: null } as GuestCartStoreLike;
const failed = { lastStorageErrorCode: 'XX000' } as GuestCartStoreLike;

it('reports ok with no failure recorded', () => {
  expect(describeGuestCartStoreHealth(healthy)).toEqual({
    guestCarts: 'ok',
    guestCartsCanonical: 'enabled',
  });
});

it('reports degraded with only the token-free code', () => {
  expect(describeGuestCartStoreHealth(failed)).toEqual({
    guestCarts: 'degraded',
    guestCartsReason: 'guest cart write failed (XX000)',
    guestCartsCanonical: 'enabled',
  });
});

it('surfaces a disabled canonical bridge without degrading legacy carts', () => {
  expect(
    describeGuestCartStoreHealth({
      lastStorageErrorCode: null,
      canonicalEnabled: false,
    } as GuestCartStoreLike)
  ).toEqual({ guestCarts: 'ok', guestCartsCanonical: 'disabled' });
});
