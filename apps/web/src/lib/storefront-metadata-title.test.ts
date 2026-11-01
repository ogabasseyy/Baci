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

  it('truncates long titles at a clean word boundary instead of mid-word', () => {
    const result = buildStorefrontMetadataTitle({
      maxLength: 60,
      suffix: 'Ogabassey',
      title: 'Apple MacBook Pro 16-inch M3 Max Price in Nigeria',
    });

    expect(result.title).toBe(
      'Apple MacBook Pro 16-inch M3 Max Price in... | Ogabassey'
    );
    expect(result.title).not.toContain('Nig...');
    expect(result.title.length).toBeLessThanOrEqual(60);
  });

  it('truncates titles without a suffix at a word boundary', () => {
    const result = buildStorefrontMetadataTitle({
      maxLength: 45,
      title: 'Samsung Galaxy S24 Ultra Price in Nigeria and Full Specs Guide',
    });

    expect(result.title).toBe('Samsung Galaxy S24 Ultra Price in Nigeria...');
    expect(result.title.length).toBeLessThanOrEqual(45);
  });

  it('falls back to a raw character slice when a single unbroken token exceeds maxLength', () => {
    const result = buildStorefrontMetadataTitle({
      maxLength: 20,
      title: 'SupercalifragilisticexpialidociousDevice',
    });

    expect(result.title).toBe('Supercalifragilis...');
    expect(result.title).toHaveLength(20);
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

  it('honors a custom title length override without slicing mid-word', () => {
    const result = buildStorefrontMetadataTitle({
      maxLength: 42,
      suffix: 'Ogabassey',
      title: 'Apple Magic Keyboard 11-inch for iPad Pro and iPad Air',
    });

    expect(result.title.length).toBeLessThanOrEqual(42);
    expect(result.title).toBe('Apple Magic Keyboard... | Ogabassey');
    expect(result.title).toContain('| Ogabassey');
  });
});
