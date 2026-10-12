import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { projectControlCssHero, projectPilotCssHero } from './css-hero-adapter';
import { PilotLabCssHeroMount } from './lab-css-hero-mount';
import type { ApprovedPilotTier } from './lab-index';

const GENERATION_ID = 'a'.repeat(64);

function tiers(): ApprovedPilotTier[] {
  const rows: ApprovedPilotTier[] = [];
  for (const width of [96, 192, 384]) {
    for (const format of ['avif', 'webp'] as const) {
      rows.push({
        actualWidth: width,
        bytes: 1000 + width,
        contentType: `image/${format}`,
        delivery: 'generated',
        fileName: `tier-${width}.${format}`,
        format,
        generationId: GENERATION_ID,
        height: Math.round((width * 3) / 4),
        quality: 70,
        requestedWidth: width,
        sha256: 'b'.repeat(64),
        width,
      });
    }
  }
  return rows;
}

describe('PilotLabCssHeroMount', () => {
  const breakpoints = [
    { media: '(max-width: 768px)', requestedWidth: 384 },
    { media: '(min-width: 769px)', requestedWidth: 768 },
  ];
  // The 768 breakpoint needs a tier at or above its requested width.
  const wideTiers = () =>
    tiers().map((tier) =>
      tier.width === 384
        ? { ...tier, actualWidth: 800, height: 600, width: 800 }
        : tier
    );

  it('renders one layer per breakpoint with both staged formats', () => {
    const pilot = projectPilotCssHero({
      baseUrl: '/__pilot',
      breakpoints,
      slot: { cover: true, overlay: true },
      tiers: wideTiers(),
    });
    const control = projectControlCssHero({
      breakpoints,
      originalUrl: '/__pilot/originals/hero-bg.png',
      slot: { cover: true, overlay: true },
    });
    expect(pilot).not.toBeNull();
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const pilotHtml = renderToStaticMarkup(
      <PilotLabCssHeroMount projection={pilot} />
    );
    const controlHtml = renderToStaticMarkup(
      <PilotLabCssHeroMount projection={control} />
    );
    expect(pilotHtml.match(/data-pilot-lab-css-layer/g)).toHaveLength(2);
    expect(pilotHtml).toContain('tier-384.avif');
    expect(pilotHtml).toContain('tier-384.webp');
    expect(controlHtml).toContain('/__pilot/originals/hero-bg.png');
    // Format-honest control: one original file renders a plain url(), never
    // a typed image-set that would gate it behind AVIF/WebP claims.
    expect(controlHtml).not.toContain('image-set(');
    expect(controlHtml).not.toContain('type(');
  });

  it('gates every layer behind its own media query', () => {
    const pilot = projectPilotCssHero({
      baseUrl: '/__pilot',
      breakpoints,
      slot: { cover: true, overlay: true },
      tiers: wideTiers(),
    });
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const html = renderToStaticMarkup(
      <PilotLabCssHeroMount projection={pilot} />
    );
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(style).toContain('@media (max-width: 768px)');
    expect(style).toContain('@media (min-width: 769px)');
    expect(style).toContain('image-set(');
    // Layers carry no inline style: viewports download only the tiers
    // their media query selects.
    expect(html).not.toContain('style="');
    // Progressive enhancement: a plain WebP background-image precedes the
    // image-set so browsers without image-set still paint the hero.
    const layer = style.match(/\.plab-css-layer-0\{([^}]*)\}/)?.[1] ?? '';
    expect(layer).toMatch(
      /background-image:url\("[^"]+\.webp"\);background-image:image-set\(/
    );
  });

  it('refuses to emit unscoped media', () => {
    const pilot = projectPilotCssHero({
      baseUrl: '/__pilot',
      breakpoints,
      slot: { cover: true, overlay: true },
      tiers: wideTiers(),
    });
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const hostile = {
      ...pilot,
      breakpoints: [{ ...pilot.breakpoints[0], media: 'x"};evil{}/*' }],
    };
    expect(() =>
      renderToStaticMarkup(<PilotLabCssHeroMount projection={hostile} />)
    ).toThrow(/refusing to emit unscoped CSS media/);
  });
});
