import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCart } from '@/hooks/cart';
import { createClient } from '@/lib/supabase/client';
import { CartPageWrapper } from './cart-page-wrapper';

const mockToast = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('./cart-page', () => ({
  CartPage: () => <div>Cart page</div>,
}));

const { useSearchParams } = await import('next/navigation');

// The wrapper defers all work until the persisted cart has hydrated, so tests
// default `isHydrated` to true and opt out only when exercising the gate.
function mockUseCart(
  overrides: {
    cart?: Array<Record<string, unknown>>;
    addToCart?: ReturnType<typeof vi.fn>;
    isHydrated?: boolean;
  } = {}
): ReturnType<typeof vi.fn> {
  const addToCart = overrides.addToCart ?? vi.fn();
  vi.mocked(useCart).mockReturnValue({
    addToCart,
    cart: overrides.cart ?? [],
    isHydrated: overrides.isHydrated ?? true,
  } as unknown as ReturnType<typeof useCart>);
  return addToCart;
}

function setupProductsQuery(result: {
  data: Array<Record<string, unknown>> | null;
  error: unknown;
}) {
  const productsQuery = {
    eq: vi.fn(() => productsQuery),
    in: vi.fn(() => productsQuery),
    select: vi.fn(() => productsQuery),
    then: vi.fn(
      (
        resolve: (value: typeof result) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(result).then(resolve, reject)
    ),
  };
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn(() => productsQuery),
  } as unknown as ReturnType<typeof createClient>);

  return productsQuery;
}

describe('CartPageWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/ogabassey/cart');
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(
        'item_id=55555555-5555-4555-8555-555555555555&quiz_award_id=44444444-4444-4444-8444-444444444444&quiz_voucher_token=signed-token'
      ) as ReturnType<typeof useSearchParams>
    );
  });

  it('uses a valid cart handoff quantity and removes it from the URL', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('item_id=55555555-5555-4555-8555-555555555555&qty=3') as ReturnType<typeof useSearchParams>
    );
    window.history.pushState({}, '', '/ogabassey/cart?item_id=55555555-5555-4555-8555-555555555555&qty=3');
    const addToCart = mockUseCart();
    setupProductsQuery({ data: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Phone', status: 'active', images: [] }], error: null });

    render(<CartPageWrapper merchantId="merchant-1" />);

    await waitFor(() => expect(addToCart).toHaveBeenCalledWith(expect.objectContaining({ id: '55555555-5555-4555-8555-555555555555' }), 3, undefined));
    expect(window.location.search).toBe('');
  });

  it('merges the requested quantity into an existing paid cart line', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('item_id=55555555-5555-4555-8555-555555555555&qty=3') as ReturnType<typeof useSearchParams>
    );
    window.history.pushState({}, '', '/ogabassey/cart?item_id=55555555-5555-4555-8555-555555555555&qty=3');
    const addToCart = mockUseCart({
      cart: [{ id: '55555555-5555-4555-8555-555555555555', quantity: 2 }],
    });
    setupProductsQuery({ data: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Phone', status: 'active', images: [] }], error: null });

    render(<CartPageWrapper merchantId="merchant-1" />);

    await waitFor(() => expect(addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ id: '55555555-5555-4555-8555-555555555555' }),
      3,
      undefined
    ));
    expect(window.location.search).toBe('');
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Added to cart' }));
  });

  it('rejects a handoff that would exceed stock after merging with a persisted line', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('item_id=55555555-5555-4555-8555-555555555555&qty=3') as ReturnType<typeof useSearchParams>
    );
    window.history.pushState({}, '', '/ogabassey/cart?item_id=55555555-5555-4555-8555-555555555555&qty=3');
    const addToCart = mockUseCart({
      cart: [{ id: '55555555-5555-4555-8555-555555555555', quantity: 2 }],
    });
    setupProductsQuery({ data: [{
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Phone',
      status: 'active',
      images: [],
      manage_stock: true,
      stock_quantity: 3,
      stock: 3,
    }], error: null });

    render(<CartPageWrapper merchantId="merchant-1" />);

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Not enough stock', variant: 'destructive' })
    ));
    expect(addToCart).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Added to cart' }));
    expect(window.location.search).toContain('item_id=55555555-5555-4555-8555-555555555555');
  });

  it('falls back to one unit for an invalid handoff quantity', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('item_id=55555555-5555-4555-8555-555555555555&qty=0') as ReturnType<typeof useSearchParams>
    );
    const addToCart = mockUseCart();
    setupProductsQuery({ data: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Phone', status: 'active', images: [] }], error: null });

    render(<CartPageWrapper merchantId="merchant-1" />);

    await waitFor(() => expect(addToCart).toHaveBeenCalledWith(expect.any(Object), 1, undefined));
  });

  it('rejects a zero-quantity managed item despite positive legacy stock and names the item actually added', async () => {
    const rejectedId = '55555555-5555-4555-8555-555555555555';
    const addedId = '66666666-6666-4666-8666-666666666666';
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(`item_id=${rejectedId},${addedId}&qty=1`) as ReturnType<typeof useSearchParams>
    );
    window.history.pushState({}, '', `/ogabassey/cart?item_id=${rejectedId},${addedId}&qty=1`);
    const addToCart = mockUseCart();
    setupProductsQuery({
      data: [
        { id: rejectedId, name: 'Sold Out Phone', status: 'active', images: [], manage_stock: true, stock_quantity: 0, stock: 5 },
        { id: addedId, name: 'Available Phone', status: 'active', images: [], manage_stock: false },
      ],
      error: null,
    });

    render(<CartPageWrapper merchantId="merchant-1" />);

    await waitFor(() => expect(addToCart).toHaveBeenCalledOnce());
    expect(addToCart).toHaveBeenCalledWith(expect.objectContaining({ id: addedId }), 1, undefined);
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Added to cart',
      description: 'Available Phone has been added to your cart.',
    }));
    expect(window.location.search).toContain(rejectedId);
  });

  it('passes canonical managed stock to the cart provider when legacy stock is zero', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('item_id=55555555-5555-4555-8555-555555555555&qty=1') as ReturnType<typeof useSearchParams>
    );
    const addToCart = mockUseCart();
    setupProductsQuery({ data: [{
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Available Phone', status: 'active', images: [],
      manage_stock: true, stock_quantity: 2, stock: 0,
    }], error: null });

    render(<CartPageWrapper merchantId="merchant-1" />);

    await waitFor(() => expect(addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ stock: 2 }), 1, undefined
    ));
  });


});
