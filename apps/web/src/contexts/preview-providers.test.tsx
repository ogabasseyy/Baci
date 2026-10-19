import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewProviders } from './preview-providers';

const mocks = vi.hoisted(() => ({
  pathname: '/template-preview',
  cartProvider: vi.fn(),
  themeProvider: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('next-themes', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => {
    mocks.themeProvider();
    return <>{children}</>;
  },
}));
vi.mock('@/hooks/use-cart', () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => {
    mocks.cartProvider();
    return <>{children}</>;
  },
}));

describe('PreviewProviders', () => {
  afterEach(() => {
    mocks.pathname = '/template-preview';
    mocks.cartProvider.mockReset();
    mocks.themeProvider.mockReset();
  });

  it('mounts builder preview without persistent providers, storage, or fetches', () => {
    mocks.pathname = '/template-preview/builder-preview';
    const localStorageSpy = vi.spyOn(Storage.prototype, 'getItem');
    const sessionStorageSpy = vi.spyOn(Storage.prototype, 'getItem');
    const fetchSpy = vi.spyOn(window, 'fetch');

    render(
      <PreviewProviders>
        <output>builder preview</output>
      </PreviewProviders>
    );

    expect(screen.getByText('builder preview')).toBeInTheDocument();
    expect(mocks.cartProvider).not.toHaveBeenCalled();
    expect(mocks.themeProvider).not.toHaveBeenCalled();
    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    localStorageSpy.mockRestore();
    sessionStorageSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('retains providers for non-builder preview routes', () => {
    render(
      <PreviewProviders>
        <output>template preview</output>
      </PreviewProviders>
    );

    expect(mocks.cartProvider).toHaveBeenCalledTimes(1);
    expect(mocks.themeProvider).toHaveBeenCalledTimes(1);
  });
});
