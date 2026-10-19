import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectedCssHero } from './css-hero-adapter';
import { PilotLabCssHeroMount } from './lab-css-hero-mount';

describe('PilotLabCssHeroMount', () => {
  it('renders scoped media rules with image-set for distinct AVIF and WebP URLs', () => {
    const projection: ProjectedCssHero = {
      breakpoints: [
        {
          avifUrl: '/__pilot/hero-384.avif',
          height: 216,
          media: '(max-width: 767px)',
          webpUrl: '/__pilot/hero-384.webp',
          width: 384,
        },
      ],
      cover: true,
      fallbackUrl: '/__pilot/hero-384.webp',
      overlay: false,
    };
    const html = renderToStaticMarkup(
      <PilotLabCssHeroMount projection={projection} />
    );
    expect(html).toContain('data-pilot-lab-css-hero="true"');
    expect(html).toContain('image-set(url("/__pilot/hero-384.avif")');
    expect(html).toContain('background-size:cover;');
  });

  it('emits plain url() when avifUrl and webpUrl match and rejects unsafe media', () => {
    const controlProjection: ProjectedCssHero = {
      breakpoints: [
        {
          avifUrl: '/__pilot/originals/hero.png',
          height: 432,
          media: '(min-width: 768px)',
          webpUrl: '/__pilot/originals/hero.png',
          width: 768,
        },
      ],
      cover: false,
      fallbackUrl: '/__pilot/originals/hero.png',
      overlay: false,
    };
    const html = renderToStaticMarkup(
      <PilotLabCssHeroMount projection={controlProjection} />
    );
    expect(html).not.toContain('image-set(');
    expect(html).toContain('background-size:auto;');

    expect(() =>
      renderToStaticMarkup(
        <PilotLabCssHeroMount
          projection={{
            breakpoints: [
              {
                avifUrl: '/a.avif',
                height: 100,
                media: 'screen; } body { color: red',
                webpUrl: '/a.webp',
                width: 100,
              },
            ],
            cover: true,
            fallbackUrl: '/a.webp',
            overlay: false,
          }}
        />
      )
    ).toThrow(/refusing to emit unscoped CSS media/);
  });
});
