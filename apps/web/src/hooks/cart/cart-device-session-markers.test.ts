import { beforeEach, expect, it } from 'vitest';
import {
  clearCartDeviceRevocationPending,
  clearCartDeviceSessionActive,
  hasActiveCartDeviceSession,
  isCartDeviceRevocationPending,
  markCartDeviceRevocationPending,
  markCartDeviceSessionActive,
  resetPendingCartDeviceRevocationsForTests,
} from './cart-device-session-markers';

beforeEach(() => {
  window.localStorage.clear();
  resetPendingCartDeviceRevocationsForTests();
});

it('tracks pending revocation per merchant', () => {
  expect(isCartDeviceRevocationPending('shop')).toBe(false);
  markCartDeviceRevocationPending('shop');
  expect(isCartDeviceRevocationPending('shop')).toBe(true);
  expect(isCartDeviceRevocationPending('other')).toBe(false);
  clearCartDeviceRevocationPending('shop');
  expect(isCartDeviceRevocationPending('shop')).toBe(false);
});

it('tracks the active device session marker', () => {
  expect(hasActiveCartDeviceSession('shop')).toBe(false);
  markCartDeviceSessionActive('shop');
  expect(hasActiveCartDeviceSession('shop')).toBe(true);
  clearCartDeviceSessionActive('shop');
  expect(hasActiveCartDeviceSession('shop')).toBe(false);
});
