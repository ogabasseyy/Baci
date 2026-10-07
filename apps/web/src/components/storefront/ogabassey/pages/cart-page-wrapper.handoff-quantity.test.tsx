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
      stock_quantity: 0,
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

  it('rejects an out-of-stock managed item and names the item actually added', async () => {
    const rejectedId = '55555555-5555-4555-8555-555555555555';
    const addedId = '66666666-6666-4666-8666-666666666666';
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(`item_id=${rejectedId},${addedId}&qty=1`) as ReturnType<typeof useSearchParams>
    );
    window.history.pushState({}, '', `/ogabassey/cart?item_id=${rejectedId},${addedId}&qty=1`);
    const addToCart = mockUseCart();
    setupProductsQuery({
      data: [
        { id: rejectedId, name: 'Sold Out Phone', status: 'active', images: [], manage_stock: true, stock_quantity: 0, stock: 0 },
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


  it('rejects managed legacy stock when checkout stock_quantity is zero', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('item_id=55555555-5555-4555-8555-555555555555&qty=1') as ReturnType<typeof useSearchParams>
    );
    const addToCart = mockUseCart();
    setupProductsQuery({ data: [{
      id: '55555555-5555-4555-8555-555555555555', name: 'Legacy Phone',
      status: 'active', images: [], manage_stock: true, stock_quantity: 0, stock: 3,
    }], error: null });
    render(<CartPageWrapper merchantId="merchant-1" />);
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Not enough stock', variant: 'destructive' })
    ));
    expect(addToCart).not.toHaveBeenCalled();
  });

  it.each(['has_variants', 'has_condition_offers'])(
    'rejects direct Google Shopping handoff for %s products', async (optionFlag) => {
      vi.mocked(useSearchParams).mockReturnValue(
        new URLSearchParams('item_id=55555555-5555-4555-8555-555555555555&qty=1') as ReturnType<typeof useSearchParams>
      );
      window.history.pushState({}, '', '/ogabassey/cart?item_id=55555555-5555-4555-8555-555555555555&qty=1');
      const addToCart = mockUseCart({ cart: [{ id: '55555555-5555-4555-8555-555555555555', variantId: 'variant-1', quantity: 1 }] });
      setupProductsQuery({ data: [{
        id: '55555555-5555-4555-8555-555555555555', name: 'Option Phone',
        status: 'active', images: [], manage_stock: true, stock_quantity: 3,
        [optionFlag]: true,
      }], error: null });
      const { unmount } = render(<CartPageWrapper merchantId="merchant-1" />);
      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Choose product options', variant: 'destructive' })
      ));
      expect(addToCart).not.toHaveBeenCalled();
      await waitFor(() => expect(window.location.search).toBe(''));
      unmount();
      vi.mocked(useSearchParams).mockReturnValue(
        new URLSearchParams(window.location.search) as ReturnType<typeof useSearchParams>
      );
      render(<CartPageWrapper merchantId="merchant-1" />);
      expect(mockToast).toHaveBeenCalledTimes(1);
    }
  );

  it('transfers distinct guest quantities and adds only missing quantity on replay', async () => {
    const first = '55555555-5555-4555-8555-555555555555';
    const second = '66666666-6666-4666-8666-666666666666';
    const params = new URLSearchParams({ guest_cart: JSON.stringify([{ product_id: first, quantity: 3 }, { product_id: second, quantity: 2 }]) });
    vi.mocked(useSearchParams).mockReturnValue(params as ReturnType<typeof useSearchParams>);
    window.history.pushState({}, '', `/cart?${params}`);
    const addToCart = mockUseCart({ cart: [{ id: first, productId: first, quantity: 2, name: 'Phone', price: 10 }] });
    setupProductsQuery({ data: [{ id: first, name: 'Phone', status: 'active', images: [] }, { id: second, name: 'Camera', status: 'active', images: [] }], error: null });
    render(<CartPageWrapper merchantId="merchant-1" />);
    await waitFor(() => expect(addToCart).toHaveBeenCalledTimes(2));
    expect(addToCart).toHaveBeenCalledWith(expect.objectContaining({ id: first }), 1, undefined);
    expect(addToCart).toHaveBeenCalledWith(expect.objectContaining({ id: second }), 2, undefined);
    expect(window.location.search).toBe('');
  });

  it('does not duplicate an already transferred guest snapshot', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams({ guest_cart: JSON.stringify([{ product_id: id, quantity: 3 }]) }) as ReturnType<typeof useSearchParams>);
    const addToCart = mockUseCart({ cart: [{ id, productId: id, quantity: 3, name: 'Phone', price: 10 }] });
    setupProductsQuery({ data: [{ id, name: 'Phone', status: 'active', images: [] }], error: null });
    render(<CartPageWrapper merchantId="merchant-1" />);
    await waitFor(() => expect(screen.getByText('Cart page')).toBeTruthy());
    expect(addToCart).not.toHaveBeenCalled();
  });

  it('retains the exact guest quantity when stock prevents transfer', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    const params = new URLSearchParams({ guest_cart: JSON.stringify([{ product_id: id, quantity: 3 }]) });
    vi.mocked(useSearchParams).mockReturnValue(params as ReturnType<typeof useSearchParams>);
    window.history.pushState({}, '', `/cart?${params}`);
    const addToCart = mockUseCart();
    setupProductsQuery({ data: [{ id, name: 'Phone', status: 'active', images: [], manage_stock: true, stock_quantity: 2 }], error: null });
    render(<CartPageWrapper merchantId="merchant-1" />);
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Not enough stock' })));
    expect(addToCart).not.toHaveBeenCalled();
    expect(JSON.parse(new URLSearchParams(window.location.search).get('guest_cart') || 'null')).toEqual([{ product_id: id, quantity: 3 }]);
  });

  it('retains guest lines missing from the catalog and notifies the shopper', async () => {
    const added = '55555555-5555-4555-8555-555555555555';
    const missing = '66666666-6666-4666-8666-666666666666';
    const params = new URLSearchParams({ guest_cart: JSON.stringify([{ product_id: added, quantity: 1 }, { product_id: missing, quantity: 2 }]) });
    vi.mocked(useSearchParams).mockReturnValue(params as ReturnType<typeof useSearchParams>);
    window.history.pushState({}, '', `/cart?${params}`);
    const addToCart = mockUseCart();
    setupProductsQuery({ data: [{ id: added, name: 'Phone', status: 'active', images: [] }], error: null });
    render(<CartPageWrapper merchantId="merchant-1" />);
    await waitFor(() => expect(addToCart).toHaveBeenCalledOnce());
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Some items unavailable', variant: 'destructive' }));
    expect(JSON.parse(new URLSearchParams(window.location.search).get('guest_cart') || 'null')).toEqual([{ product_id: missing, quantity: 2 }]);
  });

  it('keeps a guest snapshot separate from an existing quiz prize cart', async () => {
    const params = new URLSearchParams({ guest_cart: JSON.stringify([{ product_id: '55555555-5555-4555-8555-555555555555', quantity: 1 }]) });
    vi.mocked(useSearchParams).mockReturnValue(params as ReturnType<typeof useSearchParams>);
    const addToCart = mockUseCart({ cart: [{ id: 'prize', quizAwardId: 'award', quantity: 1 }] });
    render(<CartPageWrapper merchantId="merchant-1" />);
    expect(addToCart).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Check out your prize separately' }));
  });

});
