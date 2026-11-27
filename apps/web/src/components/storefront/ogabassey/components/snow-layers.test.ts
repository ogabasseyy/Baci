import { describe, expect, it } from 'vitest';
import { SNOW_LAYERS } from './snow-layers';

describe('SNOW_LAYERS', () => {
  it('gives each layer a distinct tile, which is also its render key', () => {
    const tiles = SNOW_LAYERS.map((layer) => layer.tile);
    expect(new Set(tiles).size).toBe(SNOW_LAYERS.length);
  });

  it('keeps every flake whole inside its repeating tile', () => {
    for (const { tile, flakes } of SNOW_LAYERS) {
      expect(flakes.length).toBeGreaterThan(0);
      for (const [x, y, radius] of flakes) {
        // The gradient fades out 1px past the radius; beyond the tile edge
        // the flake would be cut in half.
        const reach = radius + 1;
        expect(Math.min(x, y) - reach).toBeGreaterThanOrEqual(0);
        expect(Math.max(x, y) + reach).toBeLessThanOrEqual(tile);
      }
    }
  });

  it('falls downwards and drifts no further than the 20px side bleed', () => {
    for (const { speed, sway } of SNOW_LAYERS) {
      expect(speed).toBeGreaterThan(0);
      expect(Math.abs(sway)).toBeLessThanOrEqual(20);
    }
  });
});
