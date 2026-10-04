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

vi.mock('next/dynamic', () => ({ default: dynamicMock }));
vi.mock('./selection-required-modal', () => ({
  SelectionRequiredModal: function SelectionRequiredModal() {
    return null;
  },
}));
vi.mock('../../components/BannerCarousel', () => ({
  BannerCarousel: function BannerCarousel() {
    return null;
  },
}));

describe('product details lazy modules', () => {
  beforeEach(() => {
    dynamicMock.mockClear();
    vi.resetModules();
  });

  it('loads SelectionRequiredModal as a client-only dynamic export', async () => {
    const { SelectionRequiredModal } = await import(
      './product-details-lazy-selection-required-modal'
    );
    const lazyComponent = SelectionRequiredModal as typeof SelectionRequiredModal & {
      loader: () => Promise<unknown>;
      options?: { ssr?: boolean };
    };

    expect(dynamicMock).toHaveBeenCalled();
    expect(lazyComponent.options?.ssr).toBe(false);
    const resolved = await lazyComponent.loader();
    expect(typeof resolved).toBe('function');
    expect((resolved as { name?: string }).name).toBe('SelectionRequiredModal');
  });

  it('loads BannerCarousel as a client-only dynamic export', async () => {
    const { BannerCarousel } = await import(
      './product-details-lazy-banner-carousel'
    );
    const lazyComponent = BannerCarousel as typeof BannerCarousel & {
      loader: () => Promise<unknown>;
      options?: { ssr?: boolean };
    };

    expect(dynamicMock).toHaveBeenCalled();
    expect(lazyComponent.options?.ssr).toBe(false);
    const resolved = await lazyComponent.loader();
    expect(typeof resolved).toBe('function');
    expect((resolved as { name?: string }).name).toBe('BannerCarousel');
  });
});
