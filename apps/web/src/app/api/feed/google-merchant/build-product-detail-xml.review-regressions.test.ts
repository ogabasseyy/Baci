import { describe, expect, it } from 'vitest';
import {
  buildGoogleColorXml,
  buildGoogleProductDetailXml,
} from './build-product-detail-xml';

describe('buildGoogleProductDetailXml review regressions', () => {
  it('skips unknown details and invalid leading RAM and storage aliases', () => {
    const xml = buildGoogleProductDetailXml({
      category: 'Smartphones',
      product_key_specs: {
        display_resolution: 'Unknown',
        ram_gb: 8,
        storage_gb: 256,
      },
      variant_attributes: {
        memory: 'N/A',
        ram: '16GB',
        storage: 'Unknown',
        rom: '1TB',
      },
    });

    expect(xml).toContain('<g:attribute_value>16GB</g:attribute_value>');
    expect(xml).toContain('<g:attribute_value>1TB</g:attribute_value>');
    expect(xml).not.toContain('Unknown');
    expect(xml).not.toContain('<g:attribute_value>8GB</g:attribute_value>');
    expect(xml).not.toContain('<g:attribute_value>256GB</g:attribute_value>');
  });

  it('falls back to the product colour when the variant value is a placeholder', () => {
    expect(
      buildGoogleColorXml({
        color: 'Black',
        variant_attributes: { color: 'N/A' },
      })
    ).toBe('        <g:color>Black</g:color>');
  });
});
