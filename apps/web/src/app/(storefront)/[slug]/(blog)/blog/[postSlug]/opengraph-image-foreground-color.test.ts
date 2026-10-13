import { describe, expect, it } from 'vitest';
import { getBlogOgForegroundColor } from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-foreground-color';

describe('getBlogOgForegroundColor', () => {
  it('projects light backgrounds to dark text and dark backgrounds to white text', () => {
    const lightForeground = getBlogOgForegroundColor('#ffffff');
    const darkForeground = getBlogOgForegroundColor('#101820');

    expect(lightForeground).toBe('#000000');
    expect(darkForeground).toBe('#FFFFFF');
  });

  it('normalizes valid rgb, hsl, and named backgrounds before choosing readable text', () => {
    const rgbForeground = getBlogOgForegroundColor('rgb(0, 0, 0)');
    const hslForeground = getBlogOgForegroundColor('hsl(240, 100%, 50%)');
    const namedForeground = getBlogOgForegroundColor('black');

    expect(rgbForeground).toBe('#FFFFFF');
    expect(hslForeground).toBe('#FFFFFF');
    expect(namedForeground).toBe('#FFFFFF');
  });

  it('composites an alpha-bearing background onto the opaque card backing', () => {
    const foreground = getBlogOgForegroundColor('rgba(0, 0, 0, 0.1)');

    expect(foreground).toBe('#FFFFFF');
  });

  it('chooses the foreground with the higher WCAG contrast ratio', () => {
    const foreground = getBlogOgForegroundColor('#24a418');

    expect(foreground).toBe('#000000');
  });

  it('chooses contrast against translucent gradient stops composited over the background', () => {
    const foreground = getBlogOgForegroundColor('#747474', [
      'rgba(255, 255, 255, 0.2)',
    ]);

    expect(foreground).toBe('#000000');
  });

  it('uses dark text when the background color is invalid', () => {
    const foreground = getBlogOgForegroundColor('not-a-color');

    expect(foreground).toBe('#000000');
  });
});
