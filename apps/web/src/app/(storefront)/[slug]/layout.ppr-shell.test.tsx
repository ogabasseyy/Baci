import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AD_ATTRIBUTION_CAPTURE_SCRIPT } from '@/components/storefront/ad-attribution-capture';
import {
  type BaseShellSnapshotWithoutCategories,
  createDeferred,
  expectThemeProviderNotRendered,
  getStorefrontShellSnapshotBase,
  resetStorefrontLayoutTestState,
  StorefrontLayout,
} from './layout.test-utils';

describe('storefront layout PPR shell', () => {
  beforeEach(() => {
    resetStorefrontLayoutTestState();
  });

  it('renders the neutral static PPR shell before params resolve', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockReturnValue(
      createDeferred<BaseShellSnapshotWithoutCategories>().promise
    );
    const deferredParams = createDeferred<{ slug: string }>();

    let unmount: () => void = () => undefined;
    let container: HTMLElement | undefined;

    const ui = StorefrontLayout({
      params: deferredParams.promise,
      children: <main>Storefront content</main>,
    });

    await act(async () => {
      ({ container, unmount } = render(ui));
      await Promise.resolve();
    });

    expectThemeProviderNotRendered();
    expect(getStorefrontShellSnapshotBase).not.toHaveBeenCalled();
    expect(
      screen.getByRole('status', { name: /loading storefront chrome/i })
    ).toBeInTheDocument();
    const staticShell = container?.querySelector(
      '.storefront-ppr-static-shell'
    );
    expect(staticShell).toBeTruthy();
    expect(staticShell).toHaveAttribute('data-storefront-shell', '');
    expect(staticShell).toHaveClass('storefront-theme-scope');
    expect(staticShell).toHaveClass('storefront-variant-default');
    expect(staticShell).toHaveClass('storefront-light');
    expect(
      container?.querySelector('.storefront-ppr-static-shell__fallback')
    ).toBeTruthy();
    expect(
      container?.querySelector('.storefront-ppr-static-shell__content')
    ).toBeFalsy();
    expect(screen.queryByText('Storefront content')).not.toBeInTheDocument();

    await act(async () => {
      deferredParams.resolve({ slug: 'generic-store' });
      await deferredParams.promise;
    });

    await waitFor(() => {
      expect(getStorefrontShellSnapshotBase).toHaveBeenCalledWith(
        'generic-store'
      );
    });

    unmount();
  });

  it('uses an explicit OgaBassey appearance for the static fallback', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockReturnValue(
      createDeferred<BaseShellSnapshotWithoutCategories>().promise
    );

    let unmount: () => void = () => undefined;
    let container: HTMLElement | undefined;

    const ui = StorefrontLayout({
      fallbackAppearance: { mode: 'system', variant: 'ogabassey' },
      params: Promise.resolve({ slug: 'ogabassey.com' }),
      children: <main>Storefront content</main>,
    });

    await act(async () => {
      ({ container, unmount } = render(ui));
      await Promise.resolve();
    });

    await screen.findByRole('status', { name: /loading storefront chrome/i });

    expectThemeProviderNotRendered();
    const staticShell = container?.querySelector(
      '.storefront-ppr-static-shell'
    );
    expect(staticShell).toHaveClass('storefront-theme-scope');
    expect(staticShell).toHaveClass('storefront-variant-ogabassey');
    expect(staticShell).toHaveClass('storefront-mode-system');
    expect(
      screen.getByRole('status', { name: /loading storefront chrome/i })
    ).toBeInTheDocument();

    unmount();
  });

  it('renders the ad attribution capture script in the static shell before tenant data resolves', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockReturnValue(
      createDeferred<BaseShellSnapshotWithoutCategories>().promise
    );

    let unmount: () => void = () => undefined;
    let container: HTMLElement | undefined;

    const ui = StorefrontLayout({
      params: Promise.resolve({ slug: 'ogabassey' }),
      children: <main>Storefront content</main>,
    });

    await act(async () => {
      ({ container, unmount } = render(ui));
      await Promise.resolve();
    });

    // The inline capture script must ship with the static shell (outside the
    // dynamic Suspense leg) so fast-bounce ad landings never lose attribution.
    const script = container?.querySelector('script');
    expect(script?.textContent).toBe(AD_ATTRIBUTION_CAPTURE_SCRIPT);
    expect(script?.textContent).toContain('/api/attr');
    expect(script?.textContent).toContain('method:"POST"');

    unmount();
  });

  it('keeps explicit layout loading fallbacks overridable', async () => {
    const fallback = <div>Loading route shell</div>;

    vi.mocked(getStorefrontShellSnapshotBase).mockReturnValue(
      createDeferred<BaseShellSnapshotWithoutCategories>().promise
    );

    let unmount: () => void = () => undefined;
    let container: HTMLElement | undefined;

    const ui = StorefrontLayout({
      fallbackAppearance: { mode: 'system', variant: 'ogabassey' },
      params: Promise.resolve({ slug: 'ogabassey' }),
      loadingFallback: fallback,
      children: <main>Storefront content</main>,
    });

    await act(async () => {
      ({ container, unmount } = render(ui));
      await Promise.resolve();
    });

    await screen.findByText('Loading route shell');

    expectThemeProviderNotRendered();
    const staticShell = container?.querySelector(
      '.storefront-ppr-static-shell'
    );
    expect(staticShell).toHaveClass('storefront-variant-ogabassey');
    expect(staticShell).toHaveClass('storefront-mode-system');
    expect(screen.getByText('Loading route shell')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: /loading storefront chrome/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Storefront content')).not.toBeInTheDocument();

    unmount();
  });
});
