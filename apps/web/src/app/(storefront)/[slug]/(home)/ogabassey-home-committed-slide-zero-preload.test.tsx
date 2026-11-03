import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OgabasseyHomeCommittedSlideZeroPreload } from './ogabassey-home-committed-slide-zero-preload';

const mockResolveHeroShell = vi.hoisted(() => vi.fn());
vi.mock('@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: (...args: unknown[]) =>
    mockResolveHeroShell(...args),
}));

const LENOVO_SLIDE_ZERO_URL =
  'https://cdn.ogabassey.com/core-assets/products/used-laptops/loq-gaming-red-circle.png?v=20260927';

describe('OgabasseyHomeCommittedSlideZeroPreload', () => {
  beforeEach(() => {
    mockResolveHeroShell.mockReset();
    for (const node of document.head.querySelectorAll(
      'link[rel="preload"][as="image"]'
    )) {
      node.remove();
    }
  });

  it('preloads the live slide-0 once so the hint matches the rendered hero', async () => {
    mockResolveHeroShell.mockResolvedValue({
      status: 'published',
      merchantId: 'merchant-1',
      slides: [{ imageUrl: LENOVO_SLIDE_ZERO_URL }],
    });

    render(await OgabasseyHomeCommittedSlideZeroPreload());

    const preloads = document.head.querySelectorAll(
      'link[rel="preload"][as="image"]'
    );
    expect(preloads).toHaveLength(1);
    const [preload] = preloads;
    expect(preload?.getAttribute('rel')).toBe('preload');
    expect(preload?.getAttribute('as')).toBe('image');
    expect(preload?.getAttribute('fetchpriority')).toBe('high');
    expect(preload?.getAttribute('imagesrcset')).toContain(
      'loq-gaming-red-circle'
    );
    expect(preload?.getAttribute('imagesizes')).not.toBeNull();
  });

  it.each([
    ['a shell lookup miss', null],
    ['an unpublished merchant', { status: 'unpublished' }],
    [
      'published without slides',
      { status: 'published', merchantId: 'm', slides: [] },
    ],
  ])('emits no guessed-image preload on %s', async (_case, shell) => {
    mockResolveHeroShell.mockResolvedValue(shell);

    const ui = await OgabasseyHomeCommittedSlideZeroPreload();

    expect(ui).toBeNull();
  });
});
