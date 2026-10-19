import { describe, expect, it } from 'vitest';
import { getMcpProductCatalogColors } from './product-catalog-colors';

describe('getMcpProductCatalogColors', () => {
  it('splits comma-separated product choices before deduplicating mapping labels', () => {
    expect(getMcpProductCatalogColors({ color: ' Black, Red, , black ', colorImages: { RED: [] } }))
      .toEqual({ colors: ['Black', 'Red'], source: 'product.color+color_images', imagesByColor: { Black: [], Red: [] } });
  });

  it('preserves explicit mapping labels even when their image values are malformed', () => {
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

  it('normalizes quoted mapping labels, merges duplicate images, and preserves malformed-value labels', () => {
    expect(getMcpProductCatalogColors({ colorImages: {
      ' "Silver" ': ['"https://cdn.example/silver.jpg"'], silver: ['https://cdn.example/silver-side.jpg'], Broken: 'not an image list',
    }, getSafeCatalogImageUrl: (url) => url?.startsWith('https://') ? url : undefined })).toEqual({
      colors: ['Silver', 'Broken'], source: 'product.color_images',
      imagesByColor: { Silver: ['https://cdn.example/silver.jpg', 'https://cdn.example/silver-side.jpg'], Broken: [] },
    });
  });

  it('keeps valid strings from mixed image arrays while ignoring malformed items', () => {
    expect(getMcpProductCatalogColors({
      colorImages: { Black: ['"https://cdn.example/black.jpg"', null, 42] },
      getSafeCatalogImageUrl: (url) => url?.startsWith('https://') ? url : undefined,
    })).toEqual({
      colors: ['Black'], source: 'product.color_images',
      imagesByColor: { Black: ['https://cdn.example/black.jpg'] },
    });
  });

  it('normalizes scalar and mapping labels together and safely projects normalized deduplicated image URLs', () => {
    const safeUrl = (url: string | null | undefined) => url?.startsWith('https://') ? url : undefined;
    expect(getMcpProductCatalogColors({
      color: '"Black"',
      colorImages: {
        '"Black"': ['"https://cdn.example/black.jpg"'],
        Black: ['https://cdn.example/black.jpg', '"javascript:alert(1)"'],
      },
      getSafeCatalogImageUrl: safeUrl,
    })).toEqual({
      colors: ['Black'], source: 'product.color+color_images',
      imagesByColor: { Black: ['https://cdn.example/black.jpg'] },
    });
  });

  it('fails closed for unsafe images after storefront quote normalization', () => {
    const seen: string[] = [];
    expect(getMcpProductCatalogColors({
      colorImages: { Black: ['"javascript:alert(1)"'] },
      getSafeCatalogImageUrl: (url) => {
        if (url) seen.push(url);
        return url?.startsWith('https://') ? url : undefined;
      },
    })).toEqual({
      colors: ['Black'], source: 'product.color_images', imagesByColor: { Black: [] },
    });
    expect(seen).toEqual(['javascript:alert(1)']);
  });

  it('reports provenance only for labels that remain nonempty after normalization', () => {
    expect(getMcpProductCatalogColors({ color: '""', colorImages: { Black: [] } }))
      .toEqual({ colors: ['Black'], source: 'product.color_images', imagesByColor: { Black: [] } });
    expect(getMcpProductCatalogColors({ color: 'Black', colorImages: { '""': [] } }))
      .toEqual({ colors: ['Black'], source: 'product.color', imagesByColor: { Black: [] } });
  });
});
