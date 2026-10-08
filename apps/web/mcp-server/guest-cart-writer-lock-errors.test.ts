import { expect, it } from 'vitest';
import {
  guestCartWriteError,
  GuestCartStorageUnavailableError,
  isPermissionError,
  isStorageWriteError,
} from './guest-cart-writer-lock-errors';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: mocked`), { code });
}

it('maps permission failures to storage outages', () => {
  for (const code of ['EACCES', 'EPERM', 'EROFS']) {
    expect(isPermissionError(errno(code))).toBe(true);
    expect(isStorageWriteError(errno(code))).toBe(true);
  }
});

it('maps disk-full and disk-quota exhaustion to storage outages', () => {
  expect(isStorageWriteError(errno('ENOSPC'))).toBe(true);
  // EDQUOT: the filesystem has free space but the user/group quota is
  // exhausted — still an actionable volume outage, not a generic failure.
  expect(isStorageWriteError(errno('EDQUOT'))).toBe(true);
});

it('leaves unrelated failures unmapped', () => {
  for (const error of [
    errno('ENOENT'),
    errno('EEXIST'),
    new Error('boom'),
    null,
    undefined,
    'ENOSPC',
  ]) {
    expect(isStorageWriteError(error)).toBe(false);
  }
});

it('wraps the target and cause in a typed storage error', () => {
  const error = guestCartWriteError('/carts', errno('EDQUOT'));
  expect(error).toBeInstanceOf(GuestCartStorageUnavailableError);
  expect(error.message).toContain('/carts');
  expect(error.message).toContain('EDQUOT');
});
