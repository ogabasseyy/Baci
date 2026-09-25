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

vi.mock('../../components/NegotiationModal', () => ({
  NegotiationModal: function NegotiationModal() {
    return null;
  },
}));

describe('product-details-lazy-negotiation-modal', () => {
  beforeEach(() => {
    dynamicMock.mockClear();
    vi.resetModules();
  });

  it('exports NegotiationModal as a client-only dynamic with null loading', async () => {
    const { NegotiationModal } = await import('./product-details-lazy-negotiation-modal');

    expect(dynamicMock).toHaveBeenCalledTimes(1);
    const lazyComponent = NegotiationModal as typeof NegotiationModal & {
      loader: () => Promise<unknown>;
      options?: { loading?: () => null; ssr?: boolean };
    };

    expect(lazyComponent.options?.ssr).toBe(false);
    expect(lazyComponent.options?.loading?.()).toBeNull();

    const resolved = await lazyComponent.loader();
    expect(typeof resolved).toBe('function');
    expect((resolved as { name?: string }).name).toBe('NegotiationModal');
  });

  it('rejects when the NegotiationModal named export is missing', async () => {
    vi.doMock('../../components/NegotiationModal', () => ({}));
    vi.resetModules();

    const { NegotiationModal } = await import('./product-details-lazy-negotiation-modal');
    const lazyComponent = NegotiationModal as typeof NegotiationModal & {
      loader: () => Promise<unknown>;
    };

    await expect(lazyComponent.loader()).rejects.toThrow(
      /No "NegotiationModal" export is defined/
    );
  });
});
