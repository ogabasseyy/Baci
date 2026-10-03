import { describe, expect, it } from 'vitest';
import { resolveVariantProductIdentifiers } from './variant-product-identifiers';

describe('resolveVariantProductIdentifiers', () => {
  it('trims variant boundary whitespace while preserving GTIN text', () => {
    expect(
      resolveVariantProductIdentifiers(
        { gtin: ' 00012345678901 ', mpn: ' MODEL-A ' },
        { gtin: 'PARENT-GTIN', mpn: 'PARENT-MPN' }
      )
    ).toEqual({ gtin: '00012345678901', mpn: 'MODEL-A' });
  });

  it('falls back to the original parent values for blank or non-string attributes', () => {
    expect(
      resolveVariantProductIdentifiers(
        { gtin: '   ', mpn: 123 },
        { gtin: ' PARENT-GTIN ', mpn: 'PARENT-MPN' }
      )
    ).toEqual({ gtin: ' PARENT-GTIN ', mpn: 'PARENT-MPN' });
  });

  it('matches Google Merchant normalized identifier keys and uses the last normalized key', () => {
    expect(
      resolveVariantProductIdentifiers(
        {
          ' GTIN ': ' 00012345678901 ',
          ' MPN ': ' FIRST ',
          mpn: ' SECOND ',
        },
        { gtin: 'PARENT-GTIN', mpn: 'PARENT-MPN' }
      )
    ).toEqual({ gtin: '00012345678901', mpn: 'SECOND' });
  });

  it('keeps the last nonblank string when later duplicate keys are ignored', () => {
    expect(
      resolveVariantProductIdentifiers(
        { gtin: ' VALID ', ' GTIN ': '   ', GtIn: false },
        { gtin: 'PARENT-GTIN' }
      )
    ).toEqual({ gtin: 'VALID' });
  });

  it('lets a finite numeric duplicate key override then falls back to the parent', () => {
    expect(
      resolveVariantProductIdentifiers(
        { gtin: 'VALID', ' GTIN ': 123 },
        { gtin: 'PARENT-GTIN' }
      )
    ).toEqual({ gtin: 'PARENT-GTIN' });
  });

  it('applies variant overrides and parent fallback independently per field', () => {
    expect(
      resolveVariantProductIdentifiers(
        { gtin: '00012345678901', mpn: '  ' },
        { gtin: 'PARENT-GTIN', mpn: 'PARENT-MPN' }
      )
    ).toEqual({ gtin: '00012345678901', mpn: 'PARENT-MPN' });
    expect(
      resolveVariantProductIdentifiers(
        { gtin: '  ', mpn: 'VARIANT-MPN' },
        { gtin: 'PARENT-GTIN', mpn: 'PARENT-MPN' }
      )
    ).toEqual({ gtin: 'PARENT-GTIN', mpn: 'VARIANT-MPN' });
  });

  it('omits identifiers when neither variant nor parent provides values', () => {
    expect(resolveVariantProductIdentifiers({}, {})).toEqual({});
  });
});
