import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { useCart } from './cart-context';
import { StorefrontCartProvider } from './storefront-cart-provider';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('storefront cart during search hydration', () => {
  it.each([
    false,
    true,
  ])('does not replace server results while the search module is pending (shared=%s)', async (sharedCartEnabled) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    );
    const container = document.createElement('div');
    document.body.append(container);
    let release!: (value: { default: typeof Results }) => void;
    let attempted = false;
    const PendingResults = lazy(() => {
      attempted = true;
      return new Promise<{ default: typeof Results }>((resolve) => {
        release = resolve;
      });
    });
    function Results() {
      // Search does not consume cart context; its client entry is still loading.
      return <h1>Search Results</h1>;
    }
    function CartBadge() {
      const cart = useCart();
      const phone: Product = {
        id: 'phone',
        merchant_id: 'merchant-1',
        name: 'Phone',
        slug: 'phone',
        price: 100,
        description: '',
        status: 'active',
        manage_stock: false,
        stock: 10,
        image: '/phone.png',
        imageLarge: '/phone.png',
        imageHint: 'phone',
        brand: '',
        gtin: '',
        mpn: '',
      };
      const lineId = cart.cart[0]?.cartItemId ?? 'phone';
      return (
        <>
          <p>{cart.isHydrated ? 'Cart ready' : 'Cart loading'}</p>
          <p>Items: {cart.totalItems}</p>
          <button type="button" onClick={() => cart.addToCart(phone, 1)}>
            Add
          </button>
          <button type="button" onClick={() => cart.updateQuantity(lineId, 3)}>
            Quantity
          </button>
          <button type="button" onClick={() => cart.removeFromCart(lineId)}>
            Remove
          </button>
          <button type="button" onClick={cart.clearCart}>
            Clear
          </button>
        </>
      );
    }
    function Tree({ client = false }: { client?: boolean }) {
      return (
        <StorefrontCartProvider
          merchantSlug="ogabassey"
          merchantId="merchant-1"
          sharedCartEnabled={sharedCartEnabled}
          deferValidationUntilIdle
        >
          <CartBadge />
          <Suspense fallback={<p>Loading search results</p>}>
            {client ? <PendingResults /> : <Results />}
          </Suspense>
        </StorefrontCartProvider>
      );
    }
    container.innerHTML = renderToString(<Tree />);
    const observed = within(container);
    const root = hydrateRoot(container, <Tree client />);
    try {
      await waitFor(() => {
        expect(attempted).toBe(true);
        expect(observed.getByText('Cart ready')).toBeVisible();
      });
      expect(observed.queryByText('Loading search results')).toBeNull();
      expect(
        observed.getByRole('heading', { name: 'Search Results' })
      ).toBeVisible();
      fireEvent.click(observed.getByRole('button', { name: 'Add' }));
      expect(observed.getByText('Items: 1')).toBeVisible();
      fireEvent.click(observed.getByRole('button', { name: 'Quantity' }));
      expect(observed.getByText('Items: 3')).toBeVisible();
      fireEvent.click(observed.getByRole('button', { name: 'Remove' }));
      expect(observed.getByText('Items: 0')).toBeVisible();
      fireEvent.click(observed.getByRole('button', { name: 'Add' }));
      fireEvent.click(observed.getByRole('button', { name: 'Clear' }));
      expect(observed.getByText('Items: 0')).toBeVisible();
      expect(
        observed.getByRole('heading', { name: 'Search Results' })
      ).toBeVisible();
      await act(async () => release({ default: Results }));
      expect(
        observed.getByRole('heading', { name: 'Search Results' })
      ).toBeVisible();
    } finally {
      await act(async () => {
        release?.({ default: Results });
        root.unmount();
      });
      container.remove();
      fetchSpy.mockRestore();
    }
  });
});
