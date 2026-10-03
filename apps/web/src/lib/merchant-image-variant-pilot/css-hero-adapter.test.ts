import { describe, expect, it } from 'vitest';
import { projectControlCssHero, projectPilotCssHero } from './css-hero-adapter';
import type { ApprovedPilotTier } from './lab-index';

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

const BREAKPOINTS = [
  { media: '(max-width: 767px)', requestedWidth: 768 },
  { media: '(min-width: 768px)', requestedWidth: 1280 },
];

describe('projectPilotCssHero', () => {
  it('selects adequate tiers per breakpoint and preserves the surface', () => {
    const tiers = [
      tier({ width: 384 }),
      tier({ format: 'avif', width: 384 }),
      tier({ width: 768 }),
      tier({ format: 'avif', width: 768 }),
      tier({ width: 1280 }),
      tier({ format: 'avif', width: 1280 }),
    ];
    const projected = projectPilotCssHero({
      baseUrl: '/__pilot',
      breakpoints: BREAKPOINTS,
      slot: { cover: true, overlay: true },
      tiers,
    });
    expect(projected).not.toBeNull();
    expect(projected?.breakpoints).toHaveLength(2);
    expect(projected?.breakpoints[0]?.width).toBe(768);
    expect(projected?.breakpoints[1]?.width).toBe(1280);
    expect(projected?.breakpoints[0]?.avifUrl).toMatch(/768\.avif$/);
    expect(projected?.breakpoints[0]?.webpUrl).toMatch(/768\.webp$/);
    expect(projected?.cover).toBe(true);
    expect(projected?.overlay).toBe(true);
  });

  it('returns null when a breakpoint exceeds the ladder', () => {
    const tiers = [tier({ width: 384 }), tier({ format: 'avif', width: 384 })];
    expect(
      projectPilotCssHero({
        baseUrl: '/__pilot',
        breakpoints: BREAKPOINTS,
        slot: { cover: true, overlay: false },
        tiers,
      })
    ).toBeNull();
  });
});

describe('projectControlCssHero', () => {
  it('mirrors the pilot shape with the original background', () => {
    const tiers = [
      tier({ width: 768 }),
      tier({ format: 'avif', width: 768 }),
      tier({ width: 1280 }),
      tier({ format: 'avif', width: 1280 }),
    ];
    const pilot = projectPilotCssHero({
      baseUrl: '/__pilot',
      breakpoints: BREAKPOINTS,
      slot: { cover: true, overlay: true },
      tiers,
    });
    const control = projectControlCssHero({
      breakpoints: BREAKPOINTS,
      originalUrl: 'https://cdn.example.com/media/hero.jpg',
      slot: { cover: true, overlay: true },
    });
    expect(Object.keys(control).sort()).toEqual(
      Object.keys(pilot ?? {}).sort()
    );
    expect(control.breakpoints).toHaveLength(2);
    expect(control.breakpoints[0]?.avifUrl).toBe(
      'https://cdn.example.com/media/hero.jpg'
    );
    expect(control.cover).toBe(true);
    expect(control.overlay).toBe(true);
  });
});
