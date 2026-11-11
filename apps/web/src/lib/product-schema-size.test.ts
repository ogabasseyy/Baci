import { describe, expect, it } from 'vitest';
import { getVariantSchemaSize } from './product-schema-size';

describe('getVariantSchemaSize', () => {
  it('omits overlong specifications and keeps usable dimensions', () => {
    expect(getVariantSchemaSize({ storage: 'X'.repeat(101) })).toBeUndefined();
    expect(getVariantSchemaSize({ size: 'X'.repeat(101), ram: '16GB' })).toBe(
      '16GB'
    );
    expect(getVariantSchemaSize({ storage: '512GB', ram: '16GB' })).toBe(
      '512GB / 16GB'
    );
  });
});
