import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AD_ATTRIBUTION_CAPTURE_SCRIPT } from '@/components/storefront/ad-attribution-capture';
import {
  type BaseShellSnapshotWithoutCategories,
  baseShellSnapshot,
  baseShellSnapshotWithoutCategories,
  createDeferred,
  getStorefrontShellSnapshot,
  getStorefrontShellSnapshotBase,
  resetStorefrontLayoutTestState,
  StorefrontLayout,
  themeProviderAppearances,
  themeProviderDocumentScopes,
} from './layout.test-utils';

describe('storefront layout PPR shell', () => {
  beforeEach(() => {
    resetStorefrontLayoutTestState();
  });

  it('commits route content directly in the static PPR shell before params resolve without trapping children in B:0', async () => {
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

    expect(getStorefrontShellSnapshotBase).not.toHaveBeenCalled();
    expect(
      container?.querySelector(
        '.storefront-ppr-static-shell__fallback [role="status"][aria-label="Loading storefront chrome"]'
      )
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
    ).toBeTruthy();
    expect(screen.getByText('Storefront content')).toBeInTheDocument();
    expect(themeProviderDocumentScopes).toEqual([false]);

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

  it('upgrades to OgaBassey shell chrome and document theme scoping without remounting the committed route node', async () => {
    const deferredBaseSnapshot =
      createDeferred<BaseShellSnapshotWithoutCategories>();
    vi.mocked(getStorefrontShellSnapshotBase).mockReturnValue(
      deferredBaseSnapshot.promise
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(baseShellSnapshot);

    let unmount: () => void = () => undefined;
    let container: HTMLElement | undefined;

    const ui = StorefrontLayout({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
      children: <main>Storefront content</main>,
    });

    await act(async () => {
      ({ container, unmount } = render(ui));
      await Promise.resolve();
    });

    const initialMainElement = screen.getByRole('main');
    expect(themeProviderDocumentScopes).toEqual([false]);

    await act(async () => {
      deferredBaseSnapshot.resolve(baseShellSnapshotWithoutCategories);
      await deferredBaseSnapshot.promise;
    });

    await waitFor(() => {
      expect(themeProviderDocumentScopes.at(-1)).toBe(true);
    });

    expect(themeProviderAppearances.at(-1)).toEqual({
      mode: 'system',
      variant: 'ogabassey',
    });
    expect(
      container?.querySelector('.ogabassey-storefront-shell')
    ).toBeTruthy();
    expect(
      container?.querySelector('#main-content.ogabassey-storefront-main > main')
    ).toBe(initialMainElement);

    unmount();
  });

  it('replaces route content with StoreNotPublished and sets the CSS hide gate for unpublished stores', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue({
      ...baseShellSnapshotWithoutCategories,
      merchant: {
        ...baseShellSnapshotWithoutCategories.merchant,
        business_name: 'Draft Store',
        is_published: false,
      },
    });

    let unmount: () => void = () => undefined;
    let container: HTMLElement | undefined;

    const ui = StorefrontLayout({
      params: Promise.resolve({ slug: 'draft-store' }),
      children: <main>Private tenant hero</main>,
    });

    await act(async () => {
      ({ container, unmount } = render(ui));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        container?.querySelector('[data-storefront-unpublished-gate]')
      ).toBeTruthy();
    });

    expect(screen.getByText('Draft Store unpublished')).toBeInTheDocument();
    expect(screen.queryByText('Private tenant hero')).not.toBeInTheDocument();

    unmount();
  });

  it('uses an explicit OgaBassey appearance for the static fallback wrapper', async () => {
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

    await waitFor(() => {
      expect(
        container?.querySelector(
          '.storefront-ppr-static-shell__fallback [role="status"][aria-label="Loading storefront chrome"]'
        )
      ).toBeInTheDocument();
    });

    expect(themeProviderDocumentScopes).toEqual([false]);
    const staticShell = container?.querySelector(
      '.storefront-ppr-static-shell'
    );
    expect(staticShell).toHaveClass('storefront-theme-scope');
    expect(staticShell).toHaveClass('storefront-variant-ogabassey');
    expect(staticShell).toHaveClass('storefront-mode-system');
    expect(screen.getByText('Storefront content')).toBeInTheDocument();

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

    expect(themeProviderDocumentScopes).toEqual([false]);
    const staticShell = container?.querySelector(
      '.storefront-ppr-static-shell'
    );
    expect(staticShell).toHaveClass('storefront-variant-ogabassey');
    expect(staticShell).toHaveClass('storefront-mode-system');
    expect(screen.getByText('Loading route shell')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: /loading storefront chrome/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Storefront content')).toBeInTheDocument();

    unmount();
  });
});
