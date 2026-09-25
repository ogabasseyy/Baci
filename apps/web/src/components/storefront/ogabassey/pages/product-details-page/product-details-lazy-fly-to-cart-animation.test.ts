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

vi.mock('../../components/FlyToCartAnimation', () => ({
  FlyToCartAnimation: function FlyToCartAnimation() {
    return null;
  },
}));

describe('product-details-lazy-fly-to-cart-animation', () => {
  beforeEach(() => {
    dynamicMock.mockClear();
    vi.resetModules();
  });

  it('exports FlyToCartAnimation as a client-only dynamic with null loading', async () => {
    const { FlyToCartAnimation } = await import('./product-details-lazy-fly-to-cart-animation');

    expect(dynamicMock).toHaveBeenCalledTimes(1);
    const lazyComponent = FlyToCartAnimation as typeof FlyToCartAnimation & {
      loader: () => Promise<unknown>;
      options?: { loading?: () => null; ssr?: boolean };
    };

    expect(lazyComponent.options?.ssr).toBe(false);
    expect(lazyComponent.options?.loading?.()).toBeNull();

    const resolved = await lazyComponent.loader();
    expect(typeof resolved).toBe('function');
    expect((resolved as { name?: string }).name).toBe('FlyToCartAnimation');
  });

  it('rejects when the FlyToCartAnimation named export is missing', async () => {
    vi.doMock('../../components/FlyToCartAnimation', () => ({}));
    vi.resetModules();

    const { FlyToCartAnimation } = await import('./product-details-lazy-fly-to-cart-animation');
    const lazyComponent = FlyToCartAnimation as typeof FlyToCartAnimation & {
      loader: () => Promise<unknown>;
    };

    await expect(lazyComponent.loader()).rejects.toThrow(
      /No "FlyToCartAnimation" export is defined/
    );
  });
});
