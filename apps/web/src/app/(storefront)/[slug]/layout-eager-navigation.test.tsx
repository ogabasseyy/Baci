import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import {
  baseShellSnapshot,
  baseShellSnapshotWithoutCategories,
  createDeferred,
  getStorefrontNavigationCategories,
  getStorefrontShellSnapshot,
  getStorefrontShellSnapshotBase,
  resetStorefrontLayoutTestState,
  StorefrontLayoutContent,
} from './layout.test-utils';

describe('storefront layout eager navigation', () => {
  beforeEach(() => {
    resetStorefrontLayoutTestState();
  });

  it('starts the OgaBassey navigation read before merchant resolution settles', async () => {
    const deferredBase =
      createDeferred<typeof baseShellSnapshotWithoutCategories>();

    vi.mocked(getStorefrontShellSnapshotBase).mockReturnValue(
      deferredBase.promise
    );
    vi.mocked(getStorefrontShellSnapshot).mockResolvedValue(baseShellSnapshot);

    const layoutPromise = StorefrontLayoutContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
      children: <main>Storefront content</main>,
    });

    // The eager categories read must already be in flight while the merchant
    // leg is still pending — that overlap is the whole optimization.
    await waitFor(() => {
      expect(getStorefrontNavigationCategories).toHaveBeenCalledWith(
        OGABASSEY_MERCHANT_ID
      );
    });

    deferredBase.resolve(baseShellSnapshotWithoutCategories);
    render(await layoutPromise);

    expect(getStorefrontShellSnapshot).toHaveBeenCalledWith(
      baseShellSnapshotWithoutCategories,
      {
        merchantId: OGABASSEY_MERCHANT_ID,
        categories: expect.any(Promise),
      }
    );
    expect(screen.getByText('Storefront content')).toBeInTheDocument();
  });

  it('passes no eager categories read for non-OgaBassey storefronts', async () => {
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

    expect(getStorefrontNavigationCategories).not.toHaveBeenCalled();
    expect(getStorefrontShellSnapshot).toHaveBeenCalledWith(
      genericShellSnapshotBase,
      null
    );
    expect(screen.getByText('Generic storefront content')).toBeInTheDocument();
  });
});
