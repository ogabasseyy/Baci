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

vi.mock('./selection-required-modal', () => ({
  SelectionRequiredModal: function SelectionRequiredModal() {
    return null;
  },
}));

describe('product-details-lazy-selection-required-modal', () => {
  beforeEach(() => {
    dynamicMock.mockClear();
    vi.resetModules();
  });

  it('exports SelectionRequiredModal as a client-only dynamic with null loading', async () => {
    const { SelectionRequiredModal } = await import('./product-details-lazy-selection-required-modal');

    expect(dynamicMock).toHaveBeenCalledTimes(1);
    const lazyComponent = SelectionRequiredModal as typeof SelectionRequiredModal & {
      loader: () => Promise<unknown>;
      options?: { loading?: () => null; ssr?: boolean };
    };

    expect(lazyComponent.options?.ssr).toBe(false);
    expect(lazyComponent.options?.loading?.()).toBeNull();

    const resolved = await lazyComponent.loader();
    expect(typeof resolved).toBe('function');
    expect((resolved as { name?: string }).name).toBe('SelectionRequiredModal');
  });

  it('rejects when the SelectionRequiredModal named export is missing', async () => {
    vi.doMock('./selection-required-modal', () => ({}));
    vi.resetModules();

    const { SelectionRequiredModal } = await import('./product-details-lazy-selection-required-modal');
    const lazyComponent = SelectionRequiredModal as typeof SelectionRequiredModal & {
      loader: () => Promise<unknown>;
    };

    await expect(lazyComponent.loader()).rejects.toThrow(
      /No "SelectionRequiredModal" export is defined/
    );
  });
});
