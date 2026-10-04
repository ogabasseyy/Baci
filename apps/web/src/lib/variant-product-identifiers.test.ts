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

  it('trims parent fallbacks when variant values are blank or non-string', () => {
    expect(
      resolveVariantProductIdentifiers(
        { gtin: '   ', mpn: 123 },
        { gtin: ' PARENT-GTIN ', mpn: 'PARENT-MPN' }
      )
    ).toEqual({ gtin: 'PARENT-GTIN', mpn: 'PARENT-MPN' });
  });

  it('matches Google Merchant key normalization and uses the last usable string', () => {
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

  it('ignores numeric and other non-string values without erasing a valid duplicate', () => {
    expect(
      resolveVariantProductIdentifiers(
        { gtin: ' VALID ', ' GTIN ': 123, 'gtin ': false },
        { gtin: 'PARENT-GTIN' }
      )
    ).toEqual({ gtin: 'VALID' });
    expect(
      resolveVariantProductIdentifiers({ gtin: 123 }, { gtin: 'PARENT-GTIN' })
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
    expect(
      resolveVariantProductIdentifiers(
        { gtin: ' ', mpn: false },
        {
          gtin: '  ',
          mpn: '\t',
        }
      )
    ).toEqual({});
  });
});
