import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  OGABASSEY_DESCRIPTION,
  OGABASSEY_HOME_LCP_SUPPORT,
  OGABASSEY_TITLE,
} from '@/config/ogabassey';
import { OgabasseyPublicationSafeHeroFallback } from './ogabassey-publication-safe-hero-fallback';

const HERO_IMAGE_URL =
  'https://cdn.ogabassey.com/core-assets/products/tecno.avif';

describe('OgabasseyPublicationSafeHeroFallback', () => {
  it('paints store title and description as LCP text when a published hero image exists', () => {
    const { container } = render(
      <OgabasseyPublicationSafeHeroFallback heroImageUrl={HERO_IMAGE_URL} />
    );

    expect(
      container.querySelector(
        '[data-ogabassey-publication-safe-hero-fallback="true"]'
      )
    ).toBeInTheDocument();
    expect(container.querySelector('img, picture')).not.toBeInTheDocument();
    expect(container.querySelector('style')?.textContent).toContain(
      '[data-ogabassey-desktop-hero]'
    );
    expect(
      container.querySelector(
        '[data-ogabassey-publication-safe-carousel-controls]'
      )
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-ogabassey-publication-safe-utility-fallback]'
      )
    ).not.toBeInTheDocument();

    const title = container.querySelector('.ogabassey-home-lcp-title');
    expect(title?.tagName).toBe('H1');
    expect(title).toHaveTextContent(OGABASSEY_TITLE);
    expect(
      container.querySelector('.ogabassey-home-lcp-desktop-title')
    ).toHaveTextContent(OGABASSEY_TITLE);
    expect(container.querySelector('style')?.textContent).toContain(
      '.ogabassey-home-lcp-desktop-title { display: none !important; }'
    );
    expect(
      container.querySelector(
        '[data-ogabassey-publication-safe-hero-fallback="true"]'
      )
    ).not.toHaveAttribute('aria-hidden');
    expect(
      container.querySelector('[data-ogabassey-committed-lcp-copy="true"]')
    ).toHaveClass('ogabassey-home-committed-lcp');
    expect(
      container.querySelector('[data-ogabassey-committed-lcp-copy="true"]')
    ).toHaveTextContent(OGABASSEY_HOME_LCP_SUPPORT);
    expect(
      container.querySelector('[data-ogabassey-committed-lcp-copy="true"]')
        ?.textContent
    ).not.toContain('flexible payment');
    expect(
      container.querySelector('[data-cwv-lcp-copy="home"]')
    ).toHaveTextContent(OGABASSEY_TITLE);
  });

  it('renders no image while keeping the inert skeleton when the feed is empty', () => {
    const { container } = render(
      <OgabasseyPublicationSafeHeroFallback heroImageUrl={null} />
    );

    expect(
      container.querySelector(
        '[data-ogabassey-publication-safe-hero-fallback="true"]'
      )
    ).toBeInTheDocument();
    expect(container.querySelector('img, picture')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-ogabassey-committed-lcp-copy]')
    ).not.toBeInTheDocument();
    expect(container.querySelector('h1, p')).not.toBeInTheDocument();
  });

  describe('security line: brand title only, never shopping UI', () => {
    it('emits no anchors, links, buttons, or interactive controls even with a hero image', () => {
      const { container } = render(
        <OgabasseyPublicationSafeHeroFallback heroImageUrl={HERO_IMAGE_URL} />
      );

      expect(container.querySelector('a')).not.toBeInTheDocument();
      expect(container.querySelector('[href]')).not.toBeInTheDocument();
      expect(container.querySelector('button')).not.toBeInTheDocument();
      expect(
        container.querySelector('a, button, [role="link"], [role="button"]')
      ).not.toBeInTheDocument();
    });

    it('emits no product copy, price, or PDP navigation text', () => {
      const { container } = render(
        <OgabasseyPublicationSafeHeroFallback heroImageUrl={HERO_IMAGE_URL} />
      );

      const text = container.textContent ?? '';
      expect(text).not.toContain('Tecno Spark 40 Pro');
      expect(text).not.toContain('₦');
      expect(text).not.toContain('Shop now');
      expect(text).toContain(OGABASSEY_TITLE);
      expect(text).toContain(OGABASSEY_HOME_LCP_SUPPORT);
      expect(text).not.toContain(OGABASSEY_DESCRIPTION);
    });
  });
});
