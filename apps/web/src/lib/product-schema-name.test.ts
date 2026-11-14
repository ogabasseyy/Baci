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

  it('prioritizes distinguishing attributes over a fitting specification', () => {
    expect(
      buildVariantSchemaName('Laptop', {
        spec: 'X'.repeat(140),
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

  it('reserves room for the first distinguishing attribute up to 100 characters when the product name reaches 150 characters', () => {
    const longBase = 'A'.repeat(150);
    const blackName = buildVariantSchemaName(longBase, { color: 'Black' });
    const whiteName = buildVariantSchemaName(longBase, { color: 'White' });
    expect(blackName.length).toBeLessThanOrEqual(150);
    expect(whiteName.length).toBeLessThanOrEqual(150);
    expect(blackName).toMatch(/ - Black$/);
    expect(whiteName).toMatch(/ - White$/);
    expect(blackName).not.toBe(whiteName);

    const longSizeA = `${'S'.repeat(89)}A`;
    const longSizeB = `${'S'.repeat(89)}B`;
    const sizeVariantA = buildVariantSchemaName(longBase, { size: longSizeA });
    const sizeVariantB = buildVariantSchemaName(longBase, { size: longSizeB });
    expect(sizeVariantA.length).toBeLessThanOrEqual(150);
    expect(sizeVariantB.length).toBeLessThanOrEqual(150);
    expect(sizeVariantA.endsWith(` - ${longSizeA}`)).toBe(true);
    expect(sizeVariantB.endsWith(` - ${longSizeB}`)).toBe(true);
    expect(sizeVariantA).not.toBe(sizeVariantB);
  });
});
