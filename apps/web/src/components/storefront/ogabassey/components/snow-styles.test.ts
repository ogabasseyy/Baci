import { describe, expect, it } from 'vitest';
import { SNOW_CSS, SNOW_LAYERS } from './snow-styles';

describe('snow styles', () => {
  it('loops each layer by exactly one tile at its own speed', () => {
    SNOW_LAYERS.forEach(({ tile, speed }, index) => {
      expect(SNOW_CSS).toContain(
        `animation:oga-snow-fall-${index} ${(tile / speed).toFixed(2)}s linear infinite`
      );
      expect(SNOW_CSS).toContain(`100%{transform:translate3d(0,${tile}px,0)}`);
    });
  });

  it('animates only transform, with literal values', () => {
    const frames = SNOW_CSS.match(/@keyframes[^\n]+/g) ?? [];
    expect(frames).toHaveLength(SNOW_LAYERS.length);
    for (const frame of frames) {
      expect(frame).not.toContain('var(');
      const properties = [...frame.matchAll(/\{([a-z-]+):/g)].map((m) => m[1]);
      expect(new Set(properties)).toEqual(new Set(['transform']));
    }
  });

  it('lets taps through and hides itself under reduced motion', () => {
    expect(SNOW_CSS).toMatch(/\.oga-snow\{[^}]*pointer-events:none/);
    expect(SNOW_CSS).toContain(
      '@media (prefers-reduced-motion: reduce){.oga-snow,.oga-snow-stop{display:none}}'
    );
  });
});
