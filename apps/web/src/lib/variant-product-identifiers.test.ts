import { describe, expect, it } from 'vitest';
import { productManufacturerIdentifiers } from './variant-product-identifiers';

const { normalizeParentProductIdentifiers, resolveVariantProductIdentifiers } =
  productManufacturerIdentifiers;

describe('product manufacturer identifiers', () => {
  it('trims variant strings while preserving GTIN text', () => {
    expect(
      resolveVariantProductIdentifiers({
        gtin: ' 00012345678901 ',
        mpn: ' MODEL-A ',
      })
    ).toEqual({ gtin: '00012345678901', mpn: 'MODEL-A' });
  });

  it('normalizes parent strings and omits blank or non-string runtime values', () => {
    expect(
      normalizeParentProductIdentifiers({
        gtin: ' PARENT-GTIN ',
        mpn: 'PARENT-MPN',
      })
    ).toEqual({ gtin: 'PARENT-GTIN', mpn: 'PARENT-MPN' });
    expect(
      normalizeParentProductIdentifiers({ gtin: '  ', mpn: '\t' })
    ).toEqual({});
    expect(
      normalizeParentProductIdentifiers({
        gtin: 123,
        mpn: false,
      } as unknown as {
        gtin?: string | null;
        mpn?: string | null;
      })
    ).toEqual({});
  });

  it('matches Google Merchant identifier key normalization', () => {
    expect(
      resolveVariantProductIdentifiers({
        ' GTIN ': ' 00012345678901 ',
        ' MPN ': ' FIRST ',
        mpn: ' SECOND ',
      })
    ).toEqual({ gtin: '00012345678901', mpn: 'SECOND' });
  });

  it('keeps the last usable normalized string when later values are blank or non-string', () => {
    expect(
      resolveVariantProductIdentifiers({
        gtin: ' VALID ',
        ' GTIN ': '   ',
        GtIn: false,
      })
    ).toEqual({ gtin: 'VALID' });
  });

  it('ignores numeric values without erasing a valid duplicate', () => {
    expect(
      resolveVariantProductIdentifiers({
        gtin: ' VALID ',
        ' GTIN ': 123,
        'gtin ': false,
      })
    ).toEqual({ gtin: 'VALID' });
    expect(resolveVariantProductIdentifiers({ gtin: 123 })).toEqual({});
  });

  it('omits absent variant identifiers independently per field', () => {
    expect(
      resolveVariantProductIdentifiers({
        gtin: '00012345678901',
        mpn: '  ',
      })
    ).toEqual({ gtin: '00012345678901' });
    expect(
      resolveVariantProductIdentifiers({
        gtin: '  ',
        mpn: 'VARIANT-MPN',
      })
    ).toEqual({ mpn: 'VARIANT-MPN' });
  });

  it('omits identifiers when neither source provides nonblank strings', () => {
    expect(resolveVariantProductIdentifiers({})).toEqual({});
    expect(normalizeParentProductIdentifiers({ gtin: '', mpn: null })).toEqual(
      {}
    );
  });
});
