import { describe, expect, it } from 'vitest';
import {
  getBlogOgBrandColors,
  getTransparentBlogOgBrandColors,
} from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-colors';
import type { MerchantBlogOgImageData } from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-data';

function createData(
  merchantBrandColors: MerchantBlogOgImageData['merchantBrandColors']
): MerchantBlogOgImageData {
  return {
    merchantBusinessName: 'Ogabassey',
    merchantBrandColors,
    post: null,
    featuredDataUri: null,
    featuredImageStatus: 'source_missing',
    logoDataUri: null,
  };
}

describe('merchant blog OG color helpers', () => {
  it('uses merchant brand colors when present and falls back only for missing values', () => {
    expect(
      getBlogOgBrandColors(
        createData({
          background: '#fff',
          primary: null,
          accent: '#fc0',
        })
      )
    ).toEqual({
      background: '#fff',
      primary: '#3B82F6',
      accent: '#fc0',
    });
  });

  it('flattens translucent backgrounds onto an opaque card surface', () => {
    const colors = getBlogOgBrandColors(
      createData({
        background: 'rgba(0, 0, 0, 0.1)',
        primary: '#fff',
        accent: '#fc0',
      })
    );

    expect(colors.background).toBe('rgb(23, 23, 41)');
  });

  it('parses named CSS backgrounds from merchant brand settings', () => {
    const colors = getBlogOgBrandColors(
      createData({
        background: 'white',
        primary: '#0af',
        accent: '#fc0',
      })
    );

    expect(colors.background).toBe('white');
  });

  it('converts 3-digit and 6-digit hex values into Satori-safe rgba stops', () => {
    expect(
      getTransparentBlogOgBrandColors({
        background: '#fff',
        primary: '#0af',
        accent: '#ffcc00',
      })
    ).toEqual({
      primary20: 'rgba(0, 170, 255, 0.2)',
      primary15: 'rgba(0, 170, 255, 0.15)',
      primary13: 'rgba(0, 170, 255, 0.13)',
      accent15: 'rgba(255, 204, 0, 0.15)',
    });
  });

  it('falls back to known-safe rgba values for non-hex merchant colors', () => {
    expect(
      getTransparentBlogOgBrandColors({
        background: 'rgb(255, 255, 255)',
        primary: 'rgb(0, 170, 255)',
        accent: 'not-a-color',
      })
    ).toMatchObject({
      primary20: 'rgba(59, 130, 246, 0.2)',
      accent15: 'rgba(245, 158, 11, 0.15)',
    });
  });
});
