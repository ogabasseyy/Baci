import { describe, expect, it } from 'vitest';
import { compareOrderIdempotencyText } from './compare-order-idempotency-text';

describe('compareOrderIdempotencyText.codePoints', () => {
  it('orders U+E000 before U+10000', () => {
    expect(
      compareOrderIdempotencyText.codePoints('\u{E000}', '\u{10000}')
    ).toBeLessThan(0);
    expect(
      compareOrderIdempotencyText.codePoints('\u{10000}', '\u{E000}')
    ).toBeGreaterThan(0);
  });
});

describe('compareOrderIdempotencyText.locale', () => {
  it('reproduces the historical localeCompare result on collation ties', () => {
    const localeCompare = String.prototype.localeCompare;
    String.prototype.localeCompare = () => 0;
    try {
      expect(compareOrderIdempotencyText.locale('\u00e9', 'e\u0301')).toBe(0);
      expect(
        compareOrderIdempotencyText.codePoints('\u00e9', 'e\u0301')
      ).not.toBe(0);
    } finally {
      String.prototype.localeCompare = localeCompare;
    }
  });
});
