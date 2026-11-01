import { describe, expect, it } from 'vitest';
import {
  firstPostponedBoundaryOffset,
  hasHeroPreload,
  hasMarker,
  markerNeedles,
} from './ogabassey-layout-html';

describe('hero preload detection', () => {
  it('recognizes responsive candidates with commas in transformation URLs', () => {
    const hero =
      '/cdn-image/width=750,quality=70,format=avif/core-assets/hero.avif';
    const html = `<link rel="preload" as="image" imagesrcset="${hero} 750w, /cdn-image/width=1200,quality=70/hero.avif 1200w">`;
    expect(hasHeroPreload(html, hero)).toBe(true);
    expect(hasHeroPreload(html, '/core-assets/hero.avif')).toBe(false);
  });
  it('recognizes marker variants and finds the first postponed boundary', () => {
    expect(
      hasMarker("<i data-check='yes'>", markerNeedles('data-check=yes'))
    ).toBe(true);
    expect(
      hasMarker('<i data-check="no">', markerNeedles('data-check=yes'))
    ).toBe(false);
    expect(firstPostponedBoundaryOffset('x<!--$!-->y<!--$?-->')).toBe(1);
    expect(firstPostponedBoundaryOffset('no boundary')).toBe(-1);
  });
  it('recognizes a responsive image preload without href', () => {
    const html =
      '<link rel="preload" as="image" imagesrcset="/hero.webp 640w, /hero-large.webp 1200w" imagesizes="100vw">';
    expect(hasHeroPreload(html, '/hero.webp')).toBe(true);
    expect(hasHeroPreload(html, '/hero-other.webp')).toBe(false);
  });

  it('decodes HTML-escaped query separators in responsive preload candidates', () => {
    const html =
      '<link rel="preload" as="image" imagesrcset="https://cdn.example/hero?w=640&amp;format=avif 640w">';
    expect(
      hasHeroPreload(html, 'https://cdn.example/hero?w=640&format=avif')
    ).toBe(true);
  });
});
