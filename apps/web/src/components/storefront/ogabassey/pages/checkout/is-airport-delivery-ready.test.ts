import { expect, it } from 'vitest';
import { isAirportDeliveryReady } from './is-airport-delivery-ready';
it('blocks a restored provider airport selection until a fresh air quote is chosen', () => {
  expect(isAirportDeliveryReady(true, false)).toBe(false);
  expect(isAirportDeliveryReady(true, true)).toBe(true);
  expect(isAirportDeliveryReady(false, false)).toBe(true);
});
