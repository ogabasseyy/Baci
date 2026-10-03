import { describe, expect, it } from 'vitest';
import { getMcpProductCatalogColors } from './product-catalog-colors';

describe('getMcpProductCatalogColors', () => {
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

  it('ignores malformed entries and collapses repeated labels without case sensitivity', () => {
    expect(getMcpProductCatalogColors({ colorImages: {
      ' Silver ': [], silver: ['https://cdn.example/silver.jpg'], Broken: 'not an image list',
    } })).toEqual({
      colors: ['Silver'], source: 'product.color_images',
      imagesByColor: { Silver: [] },
    });
  });
});
