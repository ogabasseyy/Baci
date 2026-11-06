import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  cart: [] as Array<{
    cartItemId: string;
    name: string;
    quantity: number;
    price: number;
    minimum_order_quantity?: number | null;
    stock?: number | null;
    offerId?: string;
    negotiatedPrice?: number;
    negotiationStatus?: 'pending' | 'accepted' | 'rejected';
    hasAssurance?: boolean;
    assuranceRate?: number;
    selectedColor?: string;
    selectedStorage?: string;
    condition?: 'new' | 'used';
    variantAttributes?: Record<string, string>;
  }>,
  subtotal: 0,
  isHydrated: true,
  hasPriceNegotiation: true,
  cartMerchantSlug: 'store',
  merchantSlug: 'store',
  setIsCartOpen: vi.fn(),
  updateQuantity: vi.fn(),
  removeFromCart: vi.fn(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    cart: state.cart,
    subtotal: state.subtotal,
    isHydrated: state.isHydrated,
    merchantSlug: state.cartMerchantSlug,
    setIsCartOpen: state.setIsCartOpen,
    updateQuantity: state.updateQuantity,
    removeFromCart: state.removeFromCart,
  }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({
    merchant: {
      slug: state.merchantSlug,
      price_negotiation_enabled: state.hasPriceNegotiation,
    },
  }),
}));
vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `₦${amount.toLocaleString()}`,
  }),
}));

import { ChatCartReview } from './chat-cart-review';

describe('ChatCartReview', () => {
  beforeEach(() => {
    state.cart = [];
    state.subtotal = 0;
    state.isHydrated = true;
    state.hasPriceNegotiation = true;
    state.cartMerchantSlug = 'store';
    state.merchantSlug = 'store';
    state.setIsCartOpen.mockClear();
    state.updateQuantity.mockClear();
    state.removeFromCart.mockClear();
  });

  it('shows canonical cart contents and opens existing cart controls only when requested', async () => {
    state.cart = [
      { cartItemId: 'line-1', name: 'Phone', quantity: 2, price: 500 },
    ];
    state.subtotal = 1000;
    const user = userEvent.setup();
    const view = render(<ChatCartReview />);

    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('2 × ₦500')).toBeInTheDocument();
    expect(screen.getByText('Estimated subtotal')).toBeInTheDocument();
    expect(screen.getByText('₦1,000')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Quantity for Phone' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decrease Phone quantity' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Increase Phone quantity' }));
    expect(state.updateQuantity).toHaveBeenCalledWith('line-1', 3);
    await user.click(screen.getByRole('button', { name: 'Remove Phone from cart' }));
    expect(state.removeFromCart).toHaveBeenCalledWith('line-1');
    expect(
      screen.getByText(/Shipping, tax, and final total/)
    ).toBeInTheDocument();

    state.cart = [
      { cartItemId: 'line-1', name: 'Phone', quantity: 1, price: 500 },
    ];
    state.subtotal = 500;
    view.rerender(<ChatCartReview />);
    expect(screen.getByText('1 × ₦500')).toBeInTheDocument();
    expect(screen.getByText('₦500')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Open cart to edit items' })
    );
    expect(state.setIsCartOpen).toHaveBeenCalledWith(true);
  });

  it('shows the empty cart state from the canonical cart', () => {
    render(<ChatCartReview />);
    expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
    expect(screen.queryByText('Estimated subtotal')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open cart to edit items' })
    ).not.toBeInTheDocument();
  });

  it('does not report an empty cart or subtotal before hydration completes', () => {
    state.isHydrated = false;
    const view = render(<ChatCartReview />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading cart');
    expect(screen.queryByText('Your cart is empty')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated subtotal')).not.toBeInTheDocument();

    state.isHydrated = true;
    state.cart = [
      { cartItemId: 'line-1', name: 'Phone', quantity: 1, price: 500 },
    ];
    state.subtotal = 500;
    view.rerender(<ChatCartReview />);

    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('Estimated subtotal')).toBeInTheDocument();
    expect(screen.getByText('₦500')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows distinguishing saved variant details for cart lines of the same product', () => {
    state.cart = [
      {
        cartItemId: 'blue-128',
        name: 'Phone',
        quantity: 1,
        price: 1000,
        selectedColor: 'Blue',
        selectedStorage: '128GB',
        condition: 'new',
      },
      {
        cartItemId: 'silver-256',
        name: 'Phone',
        quantity: 1,
        price: 1100,
        selectedColor: 'Silver',
        selectedStorage: '256GB',
        condition: 'used',
      },
    ];
    render(<ChatCartReview />);

    expect(screen.getAllByText('Phone')).toHaveLength(2);
    expect(screen.getByText('128GB')).toBeInTheDocument();
    expect(screen.getByText('Blue')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('256GB')).toBeInTheDocument();
    expect(screen.getByText('Silver')).toBeInTheDocument();
    expect(screen.getByText('Used')).toBeInTheDocument();
  });

  it('edits the exact variant cart line and respects its minimum order quantity', async () => {
    const user = userEvent.setup();
    state.cart = [
      {
        cartItemId: 'blue-128',
        name: 'Phone',
        quantity: 2,
        price: 1000,
        selectedColor: 'Blue',
        minimum_order_quantity: 2,
      },
    ];
    const view = render(<ChatCartReview />);

    expect(
      screen.getByRole('button', { name: 'Decrease Phone quantity' })
    ).toBeDisabled();
    state.cart = state.cart.map((line) => ({ ...line, quantity: 3 }));
    view.rerender(<ChatCartReview />);

    await user.click(screen.getByRole('button', { name: 'Decrease Phone quantity' }));
    expect(state.updateQuantity).toHaveBeenCalledWith('blue-128', 2);
    expect(screen.getByRole('button', { name: 'Decrease Phone quantity' })).toBeEnabled();
  });

  it('disables increase when the canonical offer allocation is already reached', () => {
    state.cart = [
      {
        cartItemId: 'allocated-line',
        name: 'Limited offer phone',
        quantity: 1,
        price: 1000,
        offerId: 'offer-1',
        stock: 1,
      },
    ];
    render(<ChatCartReview />);

    expect(
      screen.getByRole('button', { name: 'Increase Limited offer phone quantity' })
    ).toBeDisabled();
  });

  it.each([
    ['pending', 1000],
    ['rejected', 1000],
    ['accepted', 500],
  ] as const)('uses the shared checkout unit-price rule for %s negotiations', (negotiationStatus, expectedPrice) => {
    state.cart = [
      {
        cartItemId: negotiationStatus,
        name: 'Negotiated phone',
        quantity: 1,
        price: 1000,
        negotiatedPrice: 500,
        negotiationStatus,
      },
    ];
    render(<ChatCartReview />);

    expect(
      screen.getByText(`1 × ₦${expectedPrice.toLocaleString()}`)
    ).toBeInTheDocument();
  });

  it.each([
    ['negotiation disabled', false, 'store'],
    ['cart merchant differs from storefront', true, 'another-store'],
  ] as const)(
    'uses catalog pricing when %s',
    (_reason, negotiationEnabled, cartMerchantSlug) => {
      state.hasPriceNegotiation = negotiationEnabled;
      state.cartMerchantSlug = cartMerchantSlug;
      state.cart = [
        {
          cartItemId: 'negotiated-phone',
          name: 'Negotiated phone',
          quantity: 2,
          price: 1000,
          negotiatedPrice: 500,
          negotiationStatus: 'accepted',
        },
      ];
      render(<ChatCartReview />);

      expect(screen.getByText('2 × ₦1,000')).toBeInTheDocument();
      expect(screen.getByText('₦2,000')).toBeInTheDocument();
    }
  );

  it('discloses when the estimated subtotal includes selected protection', () => {
    state.cart = [
      {
        cartItemId: 'protected-phone',
        name: 'Protected phone',
        quantity: 1,
        price: 1000,
        hasAssurance: true,
        assuranceRate: 0.05,
      },
    ];
    render(<ChatCartReview />);

    expect(screen.getByText('Estimated subtotal')).toBeInTheDocument();
    expect(screen.getByText('₦1,050')).toBeInTheDocument();
    expect(
      screen.getByText(/includes selected protection/i)
    ).toBeInTheDocument();
  });
});
