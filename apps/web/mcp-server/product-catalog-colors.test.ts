import { describe, expect, it } from 'vitest';
import { getMcpProductCatalogColors } from './product-catalog-colors';

describe('getMcpProductCatalogColors', () => {
  it('splits comma-separated product choices before deduplicating mapping labels', () => {
    expect(getMcpProductCatalogColors({ color: ' Black, Red, , black ', colorImages: { RED: [] } }))
      .toEqual({ colors: ['Black', 'Red'], source: 'product.color+color_images', imagesByColor: { Black: [], Red: [] } });
  });

  it('retains nonblank legacy keys while rejecting malformed image values', () => {
    expect(getMcpProductCatalogColors({ colorImages: { Black: 'black.jpg', Red: null, ' ': [] }, getSafeCatalogImageUrl: (url) => url || undefined }))
      .toEqual({ colors: ['Black', 'Red'], source: 'product.color_images', imagesByColor: { Black: [], Red: [] } });
  });

  it('keeps scalar product color and legacy mapping labels together', () => {
    expect(getMcpProductCatalogColors({
      color: '  Graphite ', colorImages: { Blue: ['blue.jpg'] },
    })).toEqual({ colors: ['Graphite', 'Blue'], source: 'product.color+color_images', imagesByColor: { Graphite: [], Blue: [] } });
  });

  it('returns explicitly stored color image labels even without variants', () => {
    expect(getMcpProductCatalogColors({ colorImages: { Black: ['black.jpg'], Silver: [] } }))
      .toEqual({ colors: ['Black', 'Silver'], source: 'product.color_images', imagesByColor: { Black: [], Silver: [] } });
  });

  it('projects only explicitly stored safe color images', () => {
    expect(getMcpProductCatalogColors({
      colorImages: { Black: ['https://cdn.example/black.jpg', 'javascript:alert(1)'] },
      getSafeCatalogImageUrl: (url) => url?.startsWith('https://') ? url : undefined,
    })).toEqual({
      colors: ['Black'], source: 'product.color_images',
      imagesByColor: { Black: ['https://cdn.example/black.jpg'] },
    });
  });

  it.each([null, [], 'not a mapping', {}])('ignores empty or malformed mappings: %p', (colorImages) => {
    expect(getMcpProductCatalogColors({ colorImages })).toEqual({ colors: [], source: null, imagesByColor: {} });
  });

  it('keeps mapping labels independently of image shape and deduplicates casing', () => {
    expect(getMcpProductCatalogColors({ colorImages: {
      ' Silver ': [], silver: ['https://cdn.example/silver.jpg'], Broken: 'not an image list',
    } })).toEqual({
      colors: ['Silver', 'Broken'], source: 'product.color_images',
      imagesByColor: { Silver: [], Broken: [] },
    });
  });
});
