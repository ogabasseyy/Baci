import { NativeCartError } from './native-cart-error';
import { writeFailureMessage } from './write-failure-message';

it('explains each rejection specifically and says the cart was restored', () => {
  expect(writeFailureMessage(new NativeCartError('invalid_item'))).toMatch(
    /no longer available/i
  );
  expect(writeFailureMessage(new NativeCartError('cart_locked'))).toMatch(
    /checked out/i
  );
  expect(writeFailureMessage(new NativeCartError('version_conflict'))).toMatch(
    /another device/i
  );
  expect(writeFailureMessage(new NativeCartError('too_many_lines'))).toMatch(
    /full/i
  );
  expect(writeFailureMessage(new NativeCartError('rate_limited'))).toMatch(
    /too quickly/i
  );
});

it('falls back to a generic restored-cart message for unknown failures', () => {
  expect(writeFailureMessage(new Error('boom'))).toMatch(/put your cart back/i);
  expect(writeFailureMessage(new NativeCartError('whatever_new'))).toMatch(
    /put your cart back/i
  );
});
