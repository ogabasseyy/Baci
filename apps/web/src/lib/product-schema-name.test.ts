import { describe, expect, it } from 'vitest';
import { buildVariantSchemaName } from './product-schema-name';

describe('name', () => {
  it('keeps complete option values within the name limit', () => {
    expect(
      buildVariantSchemaName('Laptop', {
        color: 'Silver',
        spec: 'X'.repeat(200),
        ram: '16GB',
      })
    ).toBe('Laptop - Silver / 16GB');
  });
});
