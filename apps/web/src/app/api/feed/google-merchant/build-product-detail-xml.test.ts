import { describe, expect, it } from 'vitest';
import {
  buildGoogleColorXml,
  buildGoogleProductDetailXml,
} from './build-product-detail-xml';

describe('buildGoogleProductDetailXml', () => {
  it('returns an empty string when there are no confirmed specs', () => {
    expect(buildGoogleProductDetailXml({})).toBe('');
    expect(
      buildGoogleProductDetailXml({
        product_key_specs: {},
        variant_attributes: null,
      })
    ).toBe('');
  });

  it('emits structured Google product details for phone attributes', () => {
    const xml = buildGoogleProductDetailXml({
      category: 'Smartphones',
      product_key_specs: {
        screen_size_inches: 6.8,
        display_resolution: '3200 x 1440 (QHD+)',
        ram_gb: 12,
        storage_gb: 512,
        main_camera_mp: 108,
        front_camera_mp: 40,
        weight_g: 229,
      },
    });

    expect(xml).toContain('<g:section_name>Display</g:section_name>');
    expect(xml).toContain(
      '<g:attribute_name>Screen resolution</g:attribute_name>'
    );
    expect(xml).toContain(
      '<g:attribute_value>3200 x 1440 (QHD+)</g:attribute_value>'
    );
    expect(xml).toContain('<g:attribute_name>RAM</g:attribute_name>');
    expect(xml).toContain('<g:attribute_value>12GB</g:attribute_value>');
    expect(xml).toContain(
      '<g:attribute_name>Rear camera resolution</g:attribute_name>'
    );
    expect(xml).toContain('<g:attribute_value>108MP</g:attribute_value>');
    expect(xml).toContain('<g:attribute_value>229g</g:attribute_value>');
  });

  it('uses variant RAM and storage before scalar product specs', () => {
    const xml = buildGoogleProductDetailXml({
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 256,
      },
      variant_attributes: {
        ram: '12GB',
        storage: '1TB',
      },
    });

    expect(xml).toContain('<g:attribute_value>12GB</g:attribute_value>');
    expect(xml).toContain('<g:attribute_value>1TB</g:attribute_value>');
    expect(xml).not.toContain('<g:attribute_value>8GB</g:attribute_value>');
    expect(xml).not.toContain('<g:attribute_value>256GB</g:attribute_value>');
  });

  it('formats numeric variant RAM and storage attributes before scalar specs', () => {
    const xml = buildGoogleProductDetailXml({
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 256,
      },
      variant_attributes: {
        ram: 16,
        storage: 1024,
      },
    });

    expect(xml).toContain('<g:attribute_value>16GB</g:attribute_value>');
    expect(xml).toContain('<g:attribute_value>1TB</g:attribute_value>');
    expect(xml).not.toContain('<g:attribute_value>8GB</g:attribute_value>');
    expect(xml).not.toContain('<g:attribute_value>256GB</g:attribute_value>');
  });

  it('formats exact storage multiples of 1024GB as TB', () => {
    const oneTbXml = buildGoogleProductDetailXml({
      product_key_specs: {
        storage_gb: 1024,
      },
    });
    const twoTbXml = buildGoogleProductDetailXml({
      product_key_specs: {
        storage_gb: 2048,
      },
    });
    const nonExactXml = buildGoogleProductDetailXml({
      product_key_specs: {
        storage_gb: 1536,
      },
    });

    expect(oneTbXml).toContain('<g:attribute_value>1TB</g:attribute_value>');
    expect(twoTbXml).toContain('<g:attribute_value>2TB</g:attribute_value>');
    expect(nonExactXml).toContain(
      '<g:attribute_value>1536GB</g:attribute_value>'
    );
  });

  it('combines partial variant attributes with confirmed scalar specs', () => {
    const xml = buildGoogleProductDetailXml({
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 2048,
      },
      variant_attributes: {
        ram: '12GB',
      },
    });

    expect(xml).toContain('<g:attribute_value>12GB</g:attribute_value>');
    expect(xml).toContain('<g:attribute_value>2TB</g:attribute_value>');
    expect(xml).not.toContain('<g:attribute_value>8GB</g:attribute_value>');
  });

  it('matches variant attribute aliases case-insensitively', () => {
    const xml = buildGoogleProductDetailXml({
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 128,
      },
      variant_attributes: {
        MeMoRy: '16GB',
        ROM: '512GB',
      },
    });

    expect(xml).toContain('<g:attribute_value>16GB</g:attribute_value>');
    expect(xml).toContain('<g:attribute_value>512GB</g:attribute_value>');
    expect(xml).not.toContain('<g:attribute_value>8GB</g:attribute_value>');
    expect(xml).not.toContain('<g:attribute_value>128GB</g:attribute_value>');
  });

  it('strips HTML from variant attributes and falls back when values are blank', () => {
    const xml = buildGoogleProductDetailXml({
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 256,
      },
      variant_attributes: {
        ram: '<b>   </b>',
        storage_capacity: '<strong>1TB</strong>',
      },
    });

    expect(xml).toContain('<g:attribute_value>8GB</g:attribute_value>');
    expect(xml).toContain('<g:attribute_value>1TB</g:attribute_value>');
    expect(xml).not.toContain('<strong>');
  });

  it('uses shipping weight as a fallback when key spec weight is missing', () => {
    const xml = buildGoogleProductDetailXml({
      weight_unit: 'kg',
      weight_value: 0.45,
    });

    expect(xml).toContain('<g:attribute_name>Weight</g:attribute_name>');
    expect(xml).toContain('<g:attribute_value>0.45kg</g:attribute_value>');
  });

  it('retains shipping weight for categorized accessories', () => {
    const xml = buildGoogleProductDetailXml({
      category: 'Phone Cases',
      weight_unit: 'g',
      weight_value: 45,
    });

    expect(xml).toContain('<g:attribute_value>45g</g:attribute_value>');
  });

  it('ignores unconfirmed non-positive numeric specs', () => {
    const xml = buildGoogleProductDetailXml({
      product_key_specs: {
        screen_size_inches: 0,
        ram_gb: -8,
        storage_gb: 0,
        main_camera_mp: -1,
        front_camera_mp: 0,
        weight_g: -200,
      },
      weight_unit: 'g',
      weight_value: 0,
    });

    expect(xml).toBe('');
  });

  it('excludes whitespace-only display resolution values', () => {
    const xml = buildGoogleProductDetailXml({
      product_key_specs: {
        display_resolution: '   ',
      },
    });

    expect(xml).toBe('');
  });

  it('uses category-aware acceptance and rejects contaminated product details', () => {
    const xml = buildGoogleProductDetailXml({
      category: 'PlayStation 5',
      product_key_specs: {
        display_resolution: 'N/A',
        main_camera_mp: 50,
      },
      variant_attributes: { ram: 'N/A', storage: '0GB' },
    });

    expect(xml).toBe('');
  });

  it('escapes XML in detail values', () => {
    const xml = buildGoogleProductDetailXml({
      product_key_specs: {
        display_resolution: '5 <',
      },
      variant_attributes: {
        ram: '12GB > "fast" & \'pro\'',
      },
    });

    expect(xml).toContain('<g:attribute_value>5 &lt;</g:attribute_value>');
    expect(xml).toContain(
      '<g:attribute_value>12GB &gt; &quot;fast&quot; &amp; &apos;pro&apos;</g:attribute_value>'
    );
  });
});

describe('buildGoogleColorXml', () => {
  it('emits variant color as g:color', () => {
    const xml = buildGoogleColorXml({
      color: 'Black',
      variant_attributes: {
        color: 'Phantom Black',
      },
    });

    expect(xml).toBe('        <g:color>Phantom Black</g:color>');
  });

  it('falls back to product color when variant color is missing', () => {
    expect(
      buildGoogleColorXml({
        color: 'Black',
        variant_attributes: null,
      })
    ).toBe('        <g:color>Black</g:color>');
  });

  it('emits standalone merchandising colour for categorized accessories', () => {
    expect(
      buildGoogleColorXml({
        category: 'Phone Cases',
        color: 'Midnight Blue',
        variant_attributes: { color: 'Coral Red' },
      })
    ).toBe('        <g:color>Coral Red</g:color>');
  });

  it('returns an empty string when no color is confirmed', () => {
    expect(buildGoogleColorXml({})).toBe('');
    expect(buildGoogleColorXml({ color: '   ' })).toBe('');
  });

  it('does not emit direct product color placeholders after normalization', () => {
    expect(buildGoogleColorXml({ color: '  <b>N/A</b>  ' })).toBe('');
  });

  it('matches colour aliases case-insensitively', () => {
    const xml = buildGoogleColorXml({
      color: 'Black',
      variant_attributes: {
        CoLoUr: 'Phantom Silver',
      },
    });

    expect(xml).toBe('        <g:color>Phantom Silver</g:color>');
  });

  it('escapes XML and strips HTML from color values', () => {
    const xml = buildGoogleColorXml({
      color: 'Black',
      variant_attributes: {
        color: '<strong>Blue & Silver</strong>',
      },
    });

    expect(xml).toBe('        <g:color>Blue &amp; Silver</g:color>');
  });
});
