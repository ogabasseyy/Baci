import { describe, expect, it } from 'vitest';
import { applyFeaturedImageDefaults } from './apply-featured-image-defaults';

describe('applyFeaturedImageDefaults', () => {
  it('resets missing derived fields when the URL changes', () => {
    const updateData: Record<string, unknown> = {
      featured_image_url: 'https://cdn.example.com/new.webp',
    };

    const changed = applyFeaturedImageDefaults(updateData, {
      featured_image_url: 'https://cdn.example.com/old.webp',
    });

    expect(changed).toBe(true);
    expect(updateData).toEqual({
      featured_image_height: null,
      featured_image_url: 'https://cdn.example.com/new.webp',
      featured_image_variants: {},
      featured_image_width: null,
    });
  });

  it('preserves explicitly provided derived fields', () => {
    const updateData: Record<string, unknown> = {
      featured_image_height: 100,
      featured_image_url: 'https://cdn.example.com/new.webp',
      featured_image_variants: { thumb: 't.webp' },
      featured_image_width: 200,
    };

    applyFeaturedImageDefaults(updateData, {
      featured_image_url: 'https://cdn.example.com/old.webp',
    });

    expect(updateData).toEqual({
      featured_image_height: 100,
      featured_image_url: 'https://cdn.example.com/new.webp',
      featured_image_variants: { thumb: 't.webp' },
      featured_image_width: 200,
    });
  });

  it('leaves the payload alone when the URL is unchanged or absent', () => {
    const unchanged: Record<string, unknown> = {
      featured_image_url: 'https://cdn.example.com/same.webp',
    };
    expect(
      applyFeaturedImageDefaults(unchanged, {
        featured_image_url: 'https://cdn.example.com/same.webp',
      })
    ).toBe(false);
    expect(unchanged).toEqual({
      featured_image_url: 'https://cdn.example.com/same.webp',
    });

    const absent: Record<string, unknown> = { title: 'Untouched' };
    applyFeaturedImageDefaults(absent, {
      featured_image_url: 'https://cdn.example.com/old.webp',
    });
    expect(absent).toEqual({ title: 'Untouched' });
  });
});
