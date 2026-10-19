import { expect, it } from 'vitest';
import {
  GuestCartExpiredError,
  GuestCartFullError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';

it('pins the error names the tool matches on', () => {
  expect(new GuestCartExpiredError()).toMatchObject({
    name: 'GuestCartExpiredError',
    message: 'Guest cart expired or was removed',
  });
  expect(new GuestCartFullError()).toMatchObject({
    name: 'GuestCartFullError',
    message: 'Guest cart is full',
  });
});

it('carries the token-free outage code separately from the message', () => {
  const error = new GuestCartStorageUnavailableError('db refused it', 'XX000');
  expect(error.name).toBe('GuestCartStorageUnavailableError');
  expect(error.code).toBe('XX000');
  expect(new GuestCartStorageUnavailableError('no code').code).toBeUndefined();
});
