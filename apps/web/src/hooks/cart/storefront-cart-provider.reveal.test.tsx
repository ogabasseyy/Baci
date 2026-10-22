import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { useCart } from './cart-context';
import { StorefrontCartProvider } from './storefront-cart-provider';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('storefront cart storage restoration', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    false,
    true,
  ])('keeps revealed results visible while restoring cart state (shared=%s)', async (sharedCartEnabled) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    let resolve!: () => void;
    let ready = false;
    let suspensionAttempts = 0;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    function Results() {
      const { isHydrated } = useCart();
      if (isHydrated && !ready) {
        suspensionAttempts++;
        throw pending;
      }
      return <h1>{isHydrated ? 'Restored results' : 'Search Results'}</h1>;
    }
    render(
      <StorefrontCartProvider
        merchantSlug="ogabassey"
        merchantId="merchant-1"
        sharedCartEnabled={sharedCartEnabled}
        deferValidationUntilIdle
      >
        <Suspense fallback={<p>Loading search results</p>}>
          <Results />
        </Suspense>
      </StorefrontCartProvider>
    );
    await waitFor(() => expect(suspensionAttempts).toBeGreaterThan(0));
    expect(
      screen.queryByText('Loading search results')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Search Results' })
    ).toBeVisible();
    await act(async () => {
      ready = true;
      resolve();
      await pending;
    });
    expect(
      screen.getByRole('heading', { name: 'Restored results' })
    ).toBeVisible();
  });

  it('accepts an explicit add while initial shared-cart display hydration is suspended', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    let ready = false;
    let attempts = 0;
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    const product: Product = {
      id: 'prod-1',
      merchant_id: 'merchant-1',
      name: 'Phone',
      price: 100,
      slug: 'phone',
      brand: 'Brand',
      description: '',
      gtin: '',
      mpn: '',
      image: '/phone.png',
      imageLarge: '/phone.png',
      imageHint: 'phone',
      manage_stock: false,
      stock: 10,
      status: 'active',
    };
    function Commands() {
      const cart = useCart();
      return (
        <>
          <button type="button" onClick={() => cart.addToCart(product, 1)}>
            Add phone
          </button>
          <p>Items: {cart.cart.length}</p>
        </>
      );
    }
    function Results() {
      const { isHydrated } = useCart();
      if (isHydrated && !ready) {
        attempts++;
        throw pending;
      }
      return <h1>Search Results</h1>;
    }
    render(
      <StorefrontCartProvider
        merchantSlug="ogabassey"
        merchantId="merchant-1"
        sharedCartEnabled
        deferValidationUntilIdle
      >
        <Commands />
        <Suspense fallback={<p>Loading search results</p>}>
          <Results />
        </Suspense>
      </StorefrontCartProvider>
    );
    await waitFor(() => expect(attempts).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Add phone' }));
    expect(screen.getByText('Items: 1')).toBeVisible();
    await act(async () => {
      ready = true;
      resolve();
      await pending;
    });
    expect(screen.getByText('Items: 1')).toBeVisible();
  });
});
