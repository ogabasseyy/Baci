import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/use-cart';
import type { Product } from '@/lib/products';
import { StickyAddToCart } from './sticky-add-to-cart';

const mockAddToCart = vi.fn();
const mockUpdateQuantity = vi.fn();
const mockToast = vi.fn();

vi.mock('@/components/themed', () => ({
  ThemedButton: ({
    children,
    colorRole: _colorRole,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { colorRole?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/animated-shop-icons', () => ({
  QuantityButton: ({
    onClick,
    type,
  }: {
    onClick: () => void;
    type: 'minus' | 'plus';
  }) => (
    <button type="button" onClick={onClick}>
      {type}
    </button>
  ),
}));

vi.mock('@/hooks/use-cart', () => ({
  useCart: vi.fn(),
}));

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `₦${amount}`,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

function setMobileViewport() {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 375,
  });
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: 500,
  });
}

function makeProduct(): Product {
  return {
    id: 'product-1',
    name: 'iPhone 13 Pro',
    description: 'Phone',
    status: 'active',
    price: 550000,
    manage_stock: true,
    stock: 10,
    image: '/iphone.jpg',
    imageLarge: '/iphone.jpg',
    imageHint: 'iphone',
    brand: 'Apple',
    gtin: '',
    mpn: '',
    slug: 'iphone-13-pro',
    condition: 'new',
  };
}

describe('StickyAddToCart', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setMobileViewport();
    const { useCart } = await import('@/hooks/use-cart');
    vi.mocked(useCart).mockReturnValue({
      addToCart: mockAddToCart,
      applyCartWideNegotiation: vi.fn(),
      applyNegotiatedPrice: vi.fn(),
      cart: [],
      cartCount: 0,
      cartTotal: 0,
      clearCart: vi.fn(),
      dismissUpsell: vi.fn(),
      hasSmartCartPro: true,
      isCartOpen: false,
      isHydrated: true,
      lastAddedProduct: null,
      merchantSlug: null,
      removeFromCart: vi.fn(),
      setIsCartOpen: vi.fn(),
      setMerchantSlug: vi.fn(),
      showUpsell: false,
      subtotal: 0,
      toggleAssurance: vi.fn(),
      totalItems: 0,
      updateQuantity: mockUpdateQuantity,
    });
  });

  it('uses selected price and condition when adding an offer-driven item', async () => {
    render(
      <StickyAddToCart
        product={makeProduct()}
        selectedCondition="used"
        selectedPrice={400000}
      />
    );

    fireEvent.scroll(window);

    await waitFor(() => {
      expect(screen.getByText('₦400000')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 400000 }),
      1,
      { condition: 'used' }
    );
  });

  it('matches condition-specific cart entries and updates by cartItemId', async () => {
    const cartItem = {
      ...makeProduct(),
      cartItemId: 'product-1::condition=used',
      condition: 'used',
      quantity: 2,
    } as CartItem;
    const { useCart } = await import('@/hooks/use-cart');
    vi.mocked(useCart).mockReturnValue({
      addToCart: mockAddToCart,
      applyCartWideNegotiation: vi.fn(),
      applyNegotiatedPrice: vi.fn(),
      cart: [cartItem],
      cartCount: 1,
      cartTotal: 0,
      clearCart: vi.fn(),
      dismissUpsell: vi.fn(),
      hasSmartCartPro: true,
      isCartOpen: false,
      isHydrated: true,
      lastAddedProduct: null,
      merchantSlug: null,
      removeFromCart: vi.fn(),
      setIsCartOpen: vi.fn(),
      setMerchantSlug: vi.fn(),
      showUpsell: false,
      subtotal: 0,
      toggleAssurance: vi.fn(),
      totalItems: 2,
      updateQuantity: mockUpdateQuantity,
    });

    render(
      <StickyAddToCart
        product={makeProduct()}
        selectedCondition="used"
        selectedPrice={400000}
      />
    );

    fireEvent.scroll(window);

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'plus' }));

    expect(mockUpdateQuantity).toHaveBeenCalledWith(
      'product-1::condition=used',
      3,
      undefined
    );
  });

  it('matches simple cart entries when the stored product condition is null', async () => {
    const cartItem = {
      ...makeProduct(),
      cartItemId: 'product-1',
      condition: undefined,
      quantity: 2,
    } as CartItem;
    const { useCart } = await import('@/hooks/use-cart');
    vi.mocked(useCart).mockReturnValue({
      addToCart: mockAddToCart,
      applyCartWideNegotiation: vi.fn(),
      applyNegotiatedPrice: vi.fn(),
      cart: [cartItem],
      cartCount: 1,
      cartTotal: 0,
      clearCart: vi.fn(),
      dismissUpsell: vi.fn(),
      hasSmartCartPro: true,
      isCartOpen: false,
      isHydrated: true,
      lastAddedProduct: null,
      merchantSlug: null,
      removeFromCart: vi.fn(),
      setIsCartOpen: vi.fn(),
      setMerchantSlug: vi.fn(),
      showUpsell: false,
      subtotal: 0,
      toggleAssurance: vi.fn(),
      totalItems: 2,
      updateQuantity: mockUpdateQuantity,
    });

    render(
      <StickyAddToCart
        product={{
          ...makeProduct(),
          condition: undefined,
        }}
      />
    );

    fireEvent.scroll(window);

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'plus' }));

    expect(mockUpdateQuantity).toHaveBeenCalledWith('product-1', 3, undefined);
  });

  it('updates variant cart entries with product id plus variant id', async () => {
    const cartItem = {
      ...makeProduct(),
      cartItemId: 'product-1::variant=variant-256',
      variantId: 'variant-256',
      quantity: 2,
    } as CartItem;
    const { useCart } = await import('@/hooks/use-cart');
    vi.mocked(useCart).mockReturnValue({
      addToCart: mockAddToCart,
      applyCartWideNegotiation: vi.fn(),
      applyNegotiatedPrice: vi.fn(),
      cart: [cartItem],
      cartCount: 1,
      cartTotal: 0,
      clearCart: vi.fn(),
      dismissUpsell: vi.fn(),
      hasSmartCartPro: true,
      isCartOpen: false,
      isHydrated: true,
      lastAddedProduct: null,
      merchantSlug: null,
      removeFromCart: vi.fn(),
      setIsCartOpen: vi.fn(),
      setMerchantSlug: vi.fn(),
      showUpsell: false,
      subtotal: 0,
      toggleAssurance: vi.fn(),
      totalItems: 2,
      updateQuantity: mockUpdateQuantity,
    });

    render(
      <StickyAddToCart
        product={makeProduct()}
        selectedVariant={{
          id: 'variant-256',
          product_id: 'product-1',
          merchant_id: 'merchant-1',
          attributes: { storage: '256GB' },
          price_override: 600000,
          stock_quantity: 4,
        }}
        selectedAttributes={{ storage: '256GB' }}
        selectedPrice={600000}
      />
    );

    fireEvent.scroll(window);

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'plus' }));

    expect(mockUpdateQuantity).toHaveBeenCalledWith(
      'product-1',
      3,
      'variant-256'
    );
  });

  it('does not mutate the cart when the current selection is unavailable', async () => {
    render(
      <StickyAddToCart
        product={{
          ...makeProduct(),
          stock: 10,
        }}
        selectedCondition="used"
        selectedPrice={400000}
        selectedStock={0}
      />
    );

    fireEvent.scroll(window);

    const button = await screen.findByRole('button', { name: 'Unavailable' });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(mockAddToCart).not.toHaveBeenCalled();
    expect(mockUpdateQuantity).not.toHaveBeenCalled();
  });
});
