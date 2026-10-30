import { describe, expect, it } from 'vitest';
import { buildStorefrontMetadataTitle } from './storefront-metadata-title';

describe('buildStorefrontMetadataTitle', () => {
  it('keeps storefront titles within the SERP display budget', () => {
    const result = buildStorefrontMetadataTitle({
      suffix: 'Ogabassey',
      title:
        'Apple Magic Keyboard 11-inch for iPad Pro and iPad Air Price in Nigeria',
    });

    expect(result.title.length).toBeLessThanOrEqual(60);
    expect(result.title).toContain('| Ogabassey');
  });

  it('returns an absolute Next metadata title to bypass the platform template', () => {
    const result = buildStorefrontMetadataTitle({
      suffix: 'Ogabassey',
      title: 'AirPods Pro 2nd Gen Type-C Price in Nigeria',
    });

    expect(result.metadataTitle).toEqual({ absolute: result.title });
  });

  it('uses the fallback when the provided title is empty', () => {
    const result = buildStorefrontMetadataTitle({
      fallback: 'Smartphones',
      suffix: 'Ogabassey',
      title: '   ',
    });

    expect(result.title).toBe('Smartphones | Ogabassey');
    expect(result.metadataTitle).toEqual({ absolute: result.title });
  });

  it('does not duplicate an existing storefront suffix', () => {
    const result = buildStorefrontMetadataTitle({
      suffix: 'Ogabassey',
      title: 'Samsung Galaxy S25 Ultra Price | Ogabassey',
    });

    expect(result.title).toBe('Samsung Galaxy S25 Ultra Price | Ogabassey');
  });

  it('honors a custom title length override', () => {
    const result = buildStorefrontMetadataTitle({
      maxLength: 42,
      suffix: 'Ogabassey',
      title: 'Apple Magic Keyboard 11-inch for iPad Pro and iPad Air',
    });

    // Word-boundary cut, never mid-word ("11-inc...").
    expect(result.title).toBe('Apple Magic Keyboard... | Ogabassey');
    expect(result.title.length).toBeLessThanOrEqual(42);
  });
});
