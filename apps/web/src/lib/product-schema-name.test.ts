import { describe, expect, it } from 'vitest';
import { buildVariantSchemaName } from './product-schema-name';

describe('name', () => {
  it('keeps complete option values within the name limit and prioritizes distinguishing attributes', () => {
    expect(
      buildVariantSchemaName('Laptop', {
        spec: 'X'.repeat(200),
        color: 'Silver',
        ram: '16GB',
      })
    ).toBe('Laptop - Silver / 16GB');
  });

  it('uses the dash separator for the first attribute even when the base name is long', () => {
    const longBase = 'A'.repeat(140);
    expect(buildVariantSchemaName(longBase, { color: 'Black' })).toBe(
      `${longBase} - Black`
    );
  });
});
