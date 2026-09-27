import { beforeEach, describe, expect, it, vi } from 'vitest';

const dynamicMock = vi.hoisted(() =>
  vi.fn(
    (
      loader: () => Promise<unknown>,
      options?: { loading?: () => null; ssr?: boolean }
    ) => {
      const LazyComponent = () => null;
      (
        LazyComponent as typeof LazyComponent & {
          loader: typeof loader;
          options: typeof options;
        }
      ).loader = loader;
      (
        LazyComponent as typeof LazyComponent & {
          options: typeof options;
        }
      ).options = options;
      return LazyComponent;
    }
  )
);

vi.mock('next/dynamic', () => ({
  default: dynamicMock,
}));

vi.mock('../../components/BannerCarousel', () => ({
  BannerCarousel: function BannerCarousel() {
    return null;
  },
}));

describe('product-details-lazy-banner-carousel', () => {
  beforeEach(() => {
    dynamicMock.mockClear();
    vi.resetModules();
  });

  it('exports BannerCarousel as a client-only dynamic with null loading', async () => {
    const { BannerCarousel } = await import('./product-details-lazy-banner-carousel');

    expect(dynamicMock).toHaveBeenCalledTimes(1);
    const lazyComponent = BannerCarousel as typeof BannerCarousel & {
      loader: () => Promise<unknown>;
      options?: { loading?: () => null; ssr?: boolean };
    };

    expect(lazyComponent.options?.ssr).toBe(false);
    expect(lazyComponent.options?.loading?.()).toBeNull();

    const resolved = await lazyComponent.loader();
    expect(typeof resolved).toBe('function');
    expect((resolved as { name?: string }).name).toBe('BannerCarousel');
  });

  it('rejects when the BannerCarousel named export is missing', async () => {
    vi.doMock('../../components/BannerCarousel', () => ({}));
    vi.resetModules();

    const { BannerCarousel } = await import('./product-details-lazy-banner-carousel');
    const lazyComponent = BannerCarousel as typeof BannerCarousel & {
      loader: () => Promise<unknown>;
    };

    await expect(lazyComponent.loader()).rejects.toThrow(
      /No "BannerCarousel" export is defined/
    );
  });
});
