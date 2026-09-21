import { describe, expect, it } from 'vitest';
import {
  compareCodePoints,
  compareLocaleText,
} from './compare-order-idempotency-text';

describe('compareCodePoints', () => {
  it('orders U+E000 before U+10000', () => {
    expect(compareCodePoints('\u{E000}', '\u{10000}')).toBeLessThan(0);
    expect(compareCodePoints('\u{10000}', '\u{E000}')).toBeGreaterThan(0);
  });
});

describe('compareLocaleText', () => {
  it('reproduces the historical localeCompare result on collation ties', () => {
    const localeCompare = String.prototype.localeCompare;
    String.prototype.localeCompare = () => 0;
    try {
      expect(compareLocaleText('\u00e9', 'e\u0301')).toBe(0);
      expect(compareCodePoints('\u00e9', 'e\u0301')).not.toBe(0);
    } finally {
      String.prototype.localeCompare = localeCompare;
    }
  });
});
