import { describe, expect, it } from 'vitest';
import { areSelectionAttributesEqual } from './product-selection-attributes-equal';

describe('areSelectionAttributesEqual', () => {
  it('compares attribute maps by entry, not identity', () => {
    expect(areSelectionAttributesEqual({ a: '1' }, { a: '1', b: '2' })).toBe(
      false
    );
    expect(areSelectionAttributesEqual({ a: '1' }, { a: '2' })).toBe(false);
    expect(areSelectionAttributesEqual({ a: '1' }, { a: '1' })).toBe(true);
  });
});
