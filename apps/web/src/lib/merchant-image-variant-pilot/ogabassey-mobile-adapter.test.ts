import { describe, expect, it } from 'vitest';
import { TRANSPARENT_PIXEL_SRC } from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import type { ApprovedPilotTier } from './lab-index';
import {
  projectControlOgabasseyMobile,
  projectPilotOgabasseyMobile,
} from './ogabassey-mobile-adapter';

function tier(
  overrides: Partial<ApprovedPilotTier> & { width: number }
): ApprovedPilotTier {
  const format = overrides.format ?? 'webp';
  return {
    actualWidth: overrides.width,
    bytes: 1000,
    contentType: `image/${format}`,
    fileName: `${overrides.width}.${format}`,
    format,
    generationId: 'c'.repeat(64),
    height: Math.round(overrides.width / 2),
    quality: 70,
    requestedWidth: overrides.width,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

const SLOT = {
  alt: 'Hero product',
  imageFit: 'contain',
  media: '(max-width: 767px)',
  sizes: '(max-width: 767px) 40vw, 50vw',
} as const;

describe('projectPilotOgabasseyMobile', () => {
  const tiers = [
    tier({ width: 384 }),
    tier({ format: 'avif', width: 384 }),
    tier({ width: 768 }),
    tier({ format: 'avif', width: 768 }),
  ];

  it('feeds rendered sources and every hint owner from one projection', () => {
    const projected = projectPilotOgabasseyMobile({
      baseUrl: '/__pilot',
      slot: SLOT,
      tiers,
    });
    expect(projected).not.toBeNull();
    // The AVIF preload is byte-identical to the rendered AVIF source.
    expect(projected?.preload.imageSrcSet).toBe(projected?.avifSrcSet);
    expect(projected?.preload.imageSizes).toBe(projected?.sizes);
    expect(projected?.preload.media).toBe(projected?.media);
    expect(projected?.preload.type).toBe('image/avif');
    expect(projected?.preload.fetchPriority).toBe('high');
    expect(projected?.preload.href).toMatch(/384\.avif$/);
    // Descriptors equal encoded widths.
    expect(projected?.avifSrcSet).toMatch(/ 384w, .* 768w$/);
    expect(projected?.fallbackSrcSet).toMatch(/ 384w, .* 768w$/);
    // Transparent <img> behavior preserved.
    expect(projected?.imgSrc).toBe(TRANSPARENT_PIXEL_SRC);
  });

  it('emits no WebP preload so fallback browsers discover one image', () => {
    const projected = projectPilotOgabasseyMobile({
      baseUrl: '/__pilot',
      slot: SLOT,
      tiers,
    });
    expect(projected?.preload.type).not.toBe('image/webp');
    expect(JSON.stringify(projected?.preload)).not.toContain('.webp');
  });

  it('returns null when either format ladder is missing', () => {
    expect(
      projectPilotOgabasseyMobile({
        baseUrl: '/__pilot',
        slot: SLOT,
        tiers: [tier({ width: 384 })],
      })
    ).toBeNull();
    expect(
      projectPilotOgabasseyMobile({
        baseUrl: '/__pilot',
        slot: SLOT,
        tiers: [],
      })
    ).toBeNull();
  });
});

describe('projectControlOgabasseyMobile', () => {
  it('mirrors the pilot shape with original URLs', () => {
    const tiers = [tier({ width: 384 }), tier({ format: 'avif', width: 384 })];
    const pilot = projectPilotOgabasseyMobile({
      baseUrl: '/__pilot',
      slot: SLOT,
      tiers,
    });
    const control = projectControlOgabasseyMobile({
      originalUrl: 'https://cdn.ogabassey.com/core-assets/products/x.jpg',
      slot: SLOT,
    });
    expect(Object.keys(control).sort()).toEqual(
      Object.keys(pilot ?? {}).sort()
    );
    expect(Object.keys(control.preload).sort()).toEqual(
      Object.keys(pilot?.preload ?? {}).sort()
    );
    expect(control.preload.imageSrcSet).toBe(control.avifSrcSet);
    expect(control.imgSrc).toBe(TRANSPARENT_PIXEL_SRC);
  });
});
