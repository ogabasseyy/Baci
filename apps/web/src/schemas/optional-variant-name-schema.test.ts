import { describe, expect, it } from 'vitest';
import { optionalVariantNameSchema } from './optional-variant-name-schema';

describe('optional variant name', () => {
  it.each([undefined, null])('treats %j as absent', (value) => {
    expect(optionalVariantNameSchema.parse(value)).toBeUndefined();
  });

  it('trims and keeps a present variant name', () => {
    expect(optionalVariantNameSchema.parse('  Midnight Black  ')).toBe(
      'Midnight Black'
    );
  });

  it('treats a whitespace-only name as absent', () => {
    expect(optionalVariantNameSchema.parse('   ')).toBeUndefined();
  });

  it('sanitizes markup out of the name', () => {
    expect(optionalVariantNameSchema.parse('<b>XL</b>')).toBe('XL');
  });

  it.each([42, true, {}])('rejects non-string %j', (value) => {
    expect(() => optionalVariantNameSchema.parse(value)).toThrow();
  });
});
