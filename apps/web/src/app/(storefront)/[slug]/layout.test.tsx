import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseShellSnapshot,
  baseShellSnapshotWithoutCategories,
  createDeferred,
  getStorefrontShellSnapshot,
  getStorefrontShellSnapshotBase,
  mockOgabasseyStorefrontLayout,
  mockWebMcp,
  notFound,
  providerSnapshots,
  resetStorefrontLayoutTestState,
  StorefrontLayoutContent,
  themeProviderAppearances,
  themeProviderRenders,
} from './layout.test-utils';

describe('storefront layout', () => {
  beforeEach(() => {
    resetStorefrontLayoutTestState();
  });

  it('waits for the shell snapshot and keeps the first-render merchant shell contract observable', async () => {
    const deferredSnapshot = createDeferred<typeof baseShellSnapshot>();

    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      baseShellSnapshotWithoutCategories
    );
    vi.mocked(getStorefrontShellSnapshot).mockReturnValue(
      deferredSnapshot.promise
    );

    const layoutPromise = StorefrontLayoutContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      children: <main>Storefront content</main>,
    });

    let settled = false;
    void layoutPromise.then(() => {
      settled = true;
    });

    await waitFor(() => {
      expect(getStorefrontShellSnapshotBase).toHaveBeenCalledWith('ogabassey');
    });
    expect(getStorefrontShellSnapshot).toHaveBeenCalledWith(
      baseShellSnapshotWithoutCategories
    );

    await Promise.resolve();
    expect(settled).toBe(false);

    deferredSnapshot.resolve(baseShellSnapshot);
    render(await layoutPromise);

    expect(providerSnapshots).toEqual([baseShellSnapshot]);
    expect(screen.getByTestId('ogabassey-layout')).toHaveAttribute(
      'data-preload-hero-lcp',
      'false'
    );
    expect(mockWebMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
      }),
      undefined
    );
    expect(themeProviderRenders).toBe(1);
    expect(themeProviderAppearances).toEqual([
      { mode: 'system', variant: 'ogabassey' },
    ]);
    expect(screen.getByText('Storefront content')).toBeInTheDocument();
  });

  it('keeps generic storefront layouts from owning OgaBassey home hero preloads', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      baseShellSnapshotWithoutCategories
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(baseShellSnapshot);

    render(
      await StorefrontLayoutContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        children: <main>Storefront content</main>,
      })
    );

    expect(screen.getByTestId('ogabassey-layout')).toHaveAttribute(
      'data-preload-hero-lcp',
      'false'
    );
    expect(mockOgabasseyStorefrontLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        preloadHeroLcpImages: false,
      }),
      undefined
    );
  });

  it('renders non-OgaBassey storefront layouts without a request-bound bailout', async () => {
    const genericMerchant = {
      ...baseShellSnapshot.merchant,
      business_name: 'Generic Store',
      custom_domain: undefined,
      slug: 'generic-store',
      template_id: 'modern',
    };
    const genericShellSnapshotBase = {
      ...baseShellSnapshotWithoutCategories,
      merchant: genericMerchant,
    };
    const genericShellSnapshot = {
      ...baseShellSnapshot,
      merchant: genericMerchant,
    };

    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      genericShellSnapshotBase
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(
      genericShellSnapshot
    );

    render(
      await StorefrontLayoutContent({
        params: Promise.resolve({ slug: 'generic-store' }),
        children: <main>Generic storefront content</main>,
      })
    );

    expect(themeProviderAppearances).toEqual([
      { mode: 'light', variant: 'default' },
    ]);
    expect(screen.getByText('Generic storefront content')).toBeInTheDocument();
  });

  it('keeps non-OgaBassey storefronts forced light after the shell resolves', async () => {
    const genericMerchant = {
      ...baseShellSnapshot.merchant,
      business_name: 'Generic Store',
      custom_domain: undefined,
      slug: 'generic-store',
      template_id: 'modern',
    };
    const genericShellSnapshotBase = {
      ...baseShellSnapshotWithoutCategories,
      merchant: genericMerchant,
    };
    const genericShellSnapshot = {
      ...baseShellSnapshot,
      merchant: genericMerchant,
    };

    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      genericShellSnapshotBase
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(
      genericShellSnapshot
    );

    const ui = await StorefrontLayoutContent({
      params: Promise.resolve({ slug: 'generic-store' }),
      children: <main>Generic storefront content</main>,
    });

    render(ui);

    expect(themeProviderAppearances).toEqual([
      { mode: 'light', variant: 'default' },
    ]);
  });

  it('uses system appearance for the OgaBassey custom-domain identifier after the shell resolves', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      baseShellSnapshotWithoutCategories
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(baseShellSnapshot);

    const ui = await StorefrontLayoutContent({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
      children: <main>Storefront content</main>,
    });

    render(ui);

    expect(themeProviderAppearances).toEqual([
      { mode: 'system', variant: 'ogabassey' },
    ]);
  });

  it('calls notFound directly when the shell snapshot is missing', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(null);

    await expect(
      StorefrontLayoutContent({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        children: <main>Storefront content</main>,
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalled();
    expect(themeProviderRenders).toBe(0);
    expect(themeProviderAppearances).toEqual([]);
    expect(providerSnapshots).toEqual([]);
  });

  it('calls notFound directly when the full shell snapshot is missing', async () => {
    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue(
      baseShellSnapshotWithoutCategories
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(null);

    await expect(
      StorefrontLayoutContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        children: <main>Storefront content</main>,
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalled();
    expect(themeProviderRenders).toBe(0);
    expect(themeProviderAppearances).toEqual([]);
    expect(providerSnapshots).toEqual([]);
  });

  it('renders StoreNotPublished outside development without waiting on category work', async () => {
    const deferredSnapshot = createDeferred<typeof baseShellSnapshot>();

    vi.mocked(getStorefrontShellSnapshotBase).mockResolvedValue({
      ...baseShellSnapshotWithoutCategories,
      merchant: {
        ...baseShellSnapshotWithoutCategories.merchant,
        business_name: 'Draft Store',
        is_published: false,
      },
    });
    vi.mocked(getStorefrontShellSnapshot).mockReturnValue(
      deferredSnapshot.promise
    );

    render(
      await StorefrontLayoutContent({
        params: Promise.resolve({ slug: 'draft-store' }),
        children: <main>Storefront content</main>,
      })
    );

    expect(screen.getByText('Draft Store unpublished')).toBeInTheDocument();
    expect(screen.queryByText('Storefront content')).not.toBeInTheDocument();
    expect(themeProviderRenders).toBe(1);
    expect(themeProviderAppearances).toEqual([
      { mode: 'light', variant: 'default' },
    ]);
    expect(getStorefrontShellSnapshot).not.toHaveBeenCalled();
    expect(providerSnapshots).toEqual([]);
  });
});
