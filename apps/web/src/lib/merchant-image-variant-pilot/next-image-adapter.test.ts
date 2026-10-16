import { describe, expect, it } from 'vitest';
import type { ApprovedPilotTier } from './lab-index';
import {
  projectControlNextImage,
  projectPilotNextImage,
} from './next-image-adapter';

function tier(
  overrides: Partial<ApprovedPilotTier> & { width: number }
): ApprovedPilotTier {
  const format = overrides.format ?? 'webp';
  return {
    actualWidth: overrides.width,
    bytes: 1000,
    contentType: `image/${format}`,
    delivery: 'generated',
    fileName: `${'a'.repeat(63)}${overrides.width % 10}.${format}`,
    format,
    generationId: 'c'.repeat(64),
    height: overrides.width,
    quality: 70,
    requestedWidth: overrides.width,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

const SLOT = {
  alt: 'Store logo',
  fetchPriority: 'high',
  height: 40,
  loading: 'eager',
  sizes: '40px',
  width: 40,
} as const;

describe('projectPilotNextImage', () => {
  it('projects per-format sources with actual-width descriptors', () => {
    const tiers = [
      tier({ width: 96 }),
      tier({ format: 'avif', width: 96 }),
      tier({ width: 192 }),
      tier({ format: 'avif', width: 192 }),
    ];
    const projected = projectPilotNextImage({
      baseUrl: '/__pilot',
      slot: SLOT,
      tiers,
    });
    expect(projected).not.toBeNull();
    const avif = projected?.sources.find((source) => source.format === 'avif');
    const webp = projected?.sources.find((source) => source.format === 'webp');
    expect(avif?.srcSet).toMatch(/ 96w, .* 192w$/);
    expect(webp?.srcSet).toMatch(/ 96w, .* 192w$/);
    expect(projected?.sizes).toBe('40px');
    expect(projected?.alt).toBe('Store logo');
    expect(projected?.loading).toBe('eager');
    expect(projected?.fetchPriority).toBe('high');
    expect(projected?.fallbackSrc).toMatch(/^\/__pilot\//);
  });

  it('returns null when no approved tier exists', () => {
    expect(
      projectPilotNextImage({ baseUrl: '/__pilot', slot: SLOT, tiers: [] })
    ).toBeNull();
  });
});

describe('projectControlNextImage', () => {
  it('mirrors the pilot shape with original URLs for the no-op control', () => {
    const tiers = [tier({ width: 96 }), tier({ format: 'avif', width: 96 })];
    const pilot = projectPilotNextImage({
      baseUrl: '/__pilot',
      slot: SLOT,
      tiers,
    });
    const control = projectControlNextImage({
      originalUrl: 'https://cdn.example.com/media/logo.png',
      slot: SLOT,
    });
    expect(Object.keys(control).sort()).toEqual(
      Object.keys(pilot ?? {}).sort()
    );
    expect(control.fallbackSrc).toBe('https://cdn.example.com/media/logo.png');
    expect(control.sizes).toBe(pilot?.sizes);
    expect(control.alt).toBe(pilot?.alt);
    // Format-honest: no AVIF/WebP-typed sources over original bytes — the
    // mount renders a bare <img>, so nothing can mis-select by type.
    expect(control.sources).toEqual([]);
  });
});
