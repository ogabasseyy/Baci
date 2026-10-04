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

vi.mock('../../components/AdUnit', () => ({
  AdUnit: function AdUnit() {
    return null;
  },
}));

describe('product-details-lazy-ad-unit', () => {
  beforeEach(() => {
    dynamicMock.mockClear();
    vi.resetModules();
  });

  it('exports AdUnit as a client-only dynamic with null loading', async () => {
    const { AdUnit } = await import('./product-details-lazy-ad-unit');

    expect(dynamicMock).toHaveBeenCalledTimes(1);
    const lazyComponent = AdUnit as typeof AdUnit & {
      loader: () => Promise<unknown>;
      options?: { loading?: () => null; ssr?: boolean };
    };

    expect(lazyComponent.options?.ssr).toBe(false);
    expect(lazyComponent.options?.loading?.()).toBeNull();

    const resolved = await lazyComponent.loader();
    expect(typeof resolved).toBe('function');
    expect((resolved as { name?: string }).name).toBe('AdUnit');
  });

  it('rejects when the AdUnit named export is missing', async () => {
    vi.doMock('../../components/AdUnit', () => ({}));
    vi.resetModules();

    const { AdUnit } = await import('./product-details-lazy-ad-unit');
    const lazyComponent = AdUnit as typeof AdUnit & {
      loader: () => Promise<unknown>;
    };

    await expect(lazyComponent.loader()).rejects.toThrow(
      /No "AdUnit" export is defined/
    );
  });
});
