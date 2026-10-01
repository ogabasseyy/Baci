import { describe, expect, it } from 'vitest';
import { buildTransactionDiscountLineOccurrenceKey } from './transaction-discount-line-occurrence-key';

describe('buildTransactionDiscountLineOccurrenceKey', () => {
  it('appends a persisted line id to the canonical line key', () => {
    expect(buildTransactionDiscountLineOccurrenceKey('line-key', 2)).toBe(
      'line-key#line:2'
    );
  });
});
