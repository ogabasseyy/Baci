import { expect, it } from 'vitest';
import {
  type GuestCartStoreLike,
  describeGuestCartStoreHealth,
} from './guest-cart-health';

const healthy = { lastStorageErrorCode: null } as GuestCartStoreLike;
const failed = { lastStorageErrorCode: 'XX000' } as GuestCartStoreLike;

it('reports ok with no failure recorded', () => {
  expect(describeGuestCartStoreHealth(healthy)).toEqual({ guestCarts: 'ok' });
});

it('reports degraded with only the token-free code', () => {
  expect(describeGuestCartStoreHealth(failed)).toEqual({
    guestCarts: 'degraded',
    guestCartsReason: 'guest cart write failed (XX000)',
  });
});
