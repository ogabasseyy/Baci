import { afterEach, describe, expect, it } from 'vitest';
import {
  readCartSessionHint,
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './cart-session-hint';
import { stampSkippedEmptyGuestCartHint } from './stamp-skipped-empty-guest-cart-hint';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

describe('stampSkippedEmptyGuestCartHint', () => {
  afterEach(() => {
    resetCartSessionHintForTests();
  });

  it('stamps 0 only when the merchant hint is currently unset', () => {
    stampSkippedEmptyGuestCartHint(MERCHANT_ID);
    expect(readCartSessionHint(MERCHANT_ID)).toBe('0');

    writeCartSessionHint(MERCHANT_ID, '1');
    stampSkippedEmptyGuestCartHint(MERCHANT_ID);
    expect(readCartSessionHint(MERCHANT_ID)).toBe('1');
  });
});
