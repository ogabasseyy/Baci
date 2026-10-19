import { describe, expect, it } from 'vitest';
import { getPersistedLineKeyOccurrenceOrdinals } from './transaction-review-persisted-line-key-occurrences';

describe('getPersistedLineKeyOccurrenceOrdinals', () => {
  it('rejects occurrence ranking when the base line key is invalid', () => {
    const result = getPersistedLineKeyOccurrenceOrdinals([
      {
        line_id: 1,
        product_id: 'product-1',
        variant_attributes: { Color: 42 as unknown as string },
        variant_id: null,
      },
    ]);

    expect(result).toBeUndefined();
  });

  it('rejects duplicate occurrence ranking when persisted line ids repeat', () => {
    const result = getPersistedLineKeyOccurrenceOrdinals([
      { line_id: 7, product_id: 'product-1', variant_id: null },
      { line_id: 7, product_id: 'product-1', variant_id: null },
    ]);

    expect(result).toBeUndefined();
  });

  it('does not assign an ordinal to a single-occurrence key', () => {
    const result = getPersistedLineKeyOccurrenceOrdinals([
      { line_id: 7, product_id: 'product-1', variant_id: null },
    ]);

    expect(result).toEqual(new Map());
  });

  it('rejects duplicate occurrence ranking when a line id is missing', () => {
    const result = getPersistedLineKeyOccurrenceOrdinals([
      { line_id: 7, product_id: 'product-1', variant_id: null },
      { product_id: 'product-1', variant_id: null },
    ]);

    expect(result).toBeUndefined();
  });

  it('rejects duplicate occurrence ranking when a line id is non-positive', () => {
    const result = getPersistedLineKeyOccurrenceOrdinals([
      { line_id: 7, product_id: 'product-1', variant_id: null },
      { line_id: 0, product_id: 'product-1', variant_id: null },
    ]);

    expect(result).toBeUndefined();
  });

  it('orders duplicate occurrences by ascending persisted line id', () => {
    const result = getPersistedLineKeyOccurrenceOrdinals([
      { line_id: 20, product_id: 'product-1', variant_id: null },
      { line_id: 10, product_id: 'product-1', variant_id: null },
    ]);

    expect(result).toEqual(
      new Map([
        [0, 2],
        [1, 1],
      ])
    );
  });
});
