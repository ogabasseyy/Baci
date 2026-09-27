import { act, renderHook } from '@testing-library/react-native';
import type { QuizPrizeClaim } from '@/services/quiz';
import { useCartStore } from '@/stores/cart-store';
import type { Product } from '@/types/product';
import { useQuizPrizeClaim } from './use-quiz-prize-claim';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

const mockUseProduct = jest.fn();
jest.mock('@/hooks/use-product', () => ({
  useProduct: (identifier: string) => mockUseProduct(identifier),
}));

const product: Product = {
  id: 'prod-1',
  name: 'iPhone 15',
  slug: 'iphone-15',
  price: 500_000,
  image: 'https://cdn.example.com/iphone.jpg',
};

const prizeClaim: QuizPrizeClaim = {
  awardId: 'award-1',
  productId: 'prod-1',
  variantId: 'variant-1',
  condition: 'new',
  voucherToken: 'token-abc',
  cartPath: '/ogabassey/cart?item_id=prod-1',
};

describe('useQuizPrizeClaim', () => {
  beforeEach(() => {
    mockPush.mockClear();
    useCartStore.getState().clearCart();
    mockUseProduct.mockReturnValue({
      product,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
  });

  it('fetches the prize product by its id', () => {
    renderHook(() => useQuizPrizeClaim(prizeClaim));
    expect(mockUseProduct).toHaveBeenCalledWith('prod-1');
  });

  it('adds the prize as a voucher line and opens the cart', () => {
    const { result } = renderHook(() => useQuizPrizeClaim(prizeClaim));
    expect(result.current.isReady).toBe(true);

    act(() => {
      result.current.claimPrize();
    });

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      product_id: 'prod-1',
      slug: 'iphone-15',
      variant_id: 'variant-1',
      name: 'iPhone 15',
      // Prize is free: the voucher line must be priced 0 (the orders API trusts
      // the submitted price for voucher-verified lines).
      price: 0,
      catalog_price: 500_000,
      compare_at_price: 500_000,
      quantity: 1,
      // Raw enum, not the 'New' display label — must match the value signed
      // into the voucher for server-side token verification.
      condition: 'new',
      voucher_token: 'token-abc',
      voucher_award_id: 'award-1',
    });
    // The human-readable label is still available for the cart UI.
    expect(items[0].variant_attributes).toMatchObject({ condition: 'New' });
    expect(mockPush).toHaveBeenCalledWith('/checkout');
  });

  it('retains the selected variant override for voucher shipping tiers', () => {
    mockUseProduct.mockReturnValue({
      product: {
        ...product,
        variants: [
          {
            id: 'variant-1',
            name: '256 GB',
            price: 500_000,
            price_override: 550_000,
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
    const { result } = renderHook(() => useQuizPrizeClaim(prizeClaim));
    act(() => result.current.claimPrize());
    expect(useCartStore.getState().items[0].catalog_price).toBe(550_000);
  });

  it('uses the product price when a variant has no server price override', () => {
    mockUseProduct.mockReturnValue({
      product: {
        ...product,
        variants: [{ id: 'variant-1', name: '256 GB', price: 550_000 }],
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
    const { result } = renderHook(() => useQuizPrizeClaim(prizeClaim));
    act(() => result.current.claimPrize());
    expect(useCartStore.getState().items[0].catalog_price).toBe(500_000);
  });

  it('reports preparing and does not touch the cart while the product loads', () => {
    mockUseProduct.mockReturnValue({
      product: null,
      isLoading: true,
      error: null,
      refetch: jest.fn(),
    });

    const { result } = renderHook(() => useQuizPrizeClaim(prizeClaim));
    expect(result.current.isPreparing).toBe(true);
    expect(result.current.isReady).toBe(false);

    act(() => {
      result.current.claimPrize();
    });

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('surfaces a load error and retries via refetch', () => {
    const refetch = jest.fn();
    mockUseProduct.mockReturnValue({
      product: null,
      isLoading: false,
      error: 'Product offline',
      refetch,
    });

    const { result } = renderHook(() => useQuizPrizeClaim(prizeClaim));
    expect(result.current.error).toBe('Product offline');

    act(() => {
      result.current.retry();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('refuses to claim into a cart that already holds non-prize items', () => {
    // A serialized prize checks out as its own pre-reserved order and mobile
    // checkout clears the whole cart on success, so a paid item sitting
    // alongside the prize would be lost. The claim must be blocked instead.
    act(() => {
      useCartStore.getState().addItem({
        product_id: 'paid-1',
        slug: 'airpods',
        name: 'AirPods',
        price: 120_000,
        quantity: 1,
      });
    });

    const { result } = renderHook(() => useQuizPrizeClaim(prizeClaim));

    act(() => {
      result.current.claimPrize();
    });

    // Prize NOT added, cart untouched, no navigation, and the shopper is told why.
    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].product_id).toBe('paid-1');
    expect(result.current.blockedReason).toMatch(/already has items/i);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('refuses to add a second voucher prize before checkout', () => {
    act(() => {
      useCartStore.getState().addItem({
        product_id: 'old-prize',
        slug: 'old-prize',
        name: 'Old Prize',
        price: 0,
        quantity: 1,
        voucher_award_id: 'old-award',
        voucher_token: 'old-token',
      });
    });

    const { result } = renderHook(() => useQuizPrizeClaim(prizeClaim));

    act(() => {
      result.current.claimPrize();
    });

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      product_id: 'old-prize',
      voucher_award_id: 'old-award',
    });
    expect(result.current.blockedReason).toMatch(/already has items/i);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('auto-clears the block once the paid items leave the cart', () => {
    // Regression: after a blocked claim + Review cart, removing the paid items
    // must re-enable the claim (blockedReason cannot be sticky).
    act(() => {
      useCartStore.getState().addItem({
        product_id: 'paid-1',
        slug: 'airpods',
        name: 'AirPods',
        price: 120_000,
        quantity: 1,
      });
    });

    const { result } = renderHook(() => useQuizPrizeClaim(prizeClaim));

    act(() => {
      result.current.claimPrize();
    });
    expect(result.current.blockedReason).toMatch(/already has items/i);

    // Shopper clears the paid items; the block clears reactively.
    act(() => {
      useCartStore.getState().clearCart();
    });
    expect(result.current.blockedReason).toBeNull();
  });

  it('claims once the mixed cart is cleared, and reviewCart opens the cart', () => {
    act(() => {
      useCartStore.getState().addItem({
        product_id: 'paid-1',
        slug: 'airpods',
        name: 'AirPods',
        price: 120_000,
        quantity: 1,
      });
    });

    const { result } = renderHook(() => useQuizPrizeClaim(prizeClaim));

    act(() => {
      result.current.reviewCart();
    });
    expect(mockPush).toHaveBeenCalledWith('/cart');

    // Shopper empties the cart, then claims successfully.
    act(() => {
      useCartStore.getState().clearCart();
      result.current.claimPrize();
    });

    const { items } = useCartStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      product_id: 'prod-1',
      voucher_award_id: 'award-1',
    });
    expect(result.current.blockedReason).toBeNull();
  });
});
