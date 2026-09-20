import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  OGABASSEY_DESCRIPTION,
  OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL,
  OGABASSEY_TITLE,
} from '@/config/ogabassey';
import { OgabasseyHomeCommittedLcp } from './ogabassey-home-committed-lcp';

describe('OgabasseyHomeCommittedLcp', () => {
  it('provides document semantics without a second visible banner', async () => {
    render(
      await OgabasseyHomeCommittedLcp({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(screen.queryByText(OGABASSEY_DESCRIPTION)).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: OGABASSEY_TITLE })
    ).toHaveClass('sr-only');
    for (const role of ['img', 'link', 'button', 'region']) {
      expect(screen.queryByRole(role)).not.toBeInTheDocument();
    }
  });

  it('renders nothing for other storefronts', async () => {
    const ui = await OgabasseyHomeCommittedLcp({
      params: Promise.resolve({ slug: 'another-shop' }),
    });

    expect(ui).toBeNull();
  });

  it('emits the committed slide-0 preload hint without awaiting backend data', async () => {
    render(
      await OgabasseyHomeCommittedLcp({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    const preload = document.head.querySelector(
      'link[data-ogabassey-home-hero-preload]'
    );
    expect(preload).not.toBeNull();
    expect(preload?.getAttribute('rel')).toBe('preload');
    expect(preload?.getAttribute('as')).toBe('image');
    expect(preload?.getAttribute('fetchpriority')).toBe('high');
    expect(preload?.getAttribute('href')).toContain(
      'iphone-18-pro-max-black.avif'
    );
    expect(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL).toContain(
      'iphone-18-pro-max-black.avif'
    );
  });

  it('emits hint bytes only, never a renderable image', async () => {
    const { container } = render(
      await OgabasseyHomeCommittedLcp({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(container.querySelector('img, picture, source')).toBeNull();
  });
});
