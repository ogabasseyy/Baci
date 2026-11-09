import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import { CartPageCard } from './cart-page-card';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({
    alt,
    fill: _fill,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: ({
    alt,
    fill: _fill,
    preload: _preload,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    preload?: boolean;
  }) => <img alt={alt} {...props} />,
}));

const mockRemoveFromCart = vi.fn();
const mockToggleAssurance = vi.fn();
const mockUpdateQuantity = vi.fn();

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    removeFromCart: mockRemoveFromCart,
    toggleAssurance: mockToggleAssurance,
    updateQuantity: mockUpdateQuantity,
  }),
}));

const sampleItem: CartItem = {
  cartItemId: 'item-123',
  id: 'prod-1',
  name: 'iPhone 15 Pro Max',
  description: 'iPhone 15 Pro Max test description',
  status: 'active',
  price: 1500000,
  manage_stock: true,
  stock: 10,
  quantity: 2,
  condition: 'new',
  image: 'https://example.com/iphone.jpg',
  imageLarge: 'https://example.com/iphone.jpg',
  imageHint: 'iPhone 15 Pro Max',
  brand: 'Apple',
  gtin: '',
  mpn: '',
  hasAssurance: true,
  assuranceRate: 0.02,
};

describe('CartPageCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders product details and formatted prices', () => {
    const onOpenItemNegotiation = vi.fn();
    render(
      <CartPageCard
        basePath="/ogabassey"
        item={sampleItem}
        onOpenItemNegotiation={onOpenItemNegotiation}
      />
    );

    expect(screen.getByText('iPhone 15 Pro Max')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('₦3,000,000')).toBeInTheDocument();
  });

  it('handles quantity increment and decrement', () => {
    const onOpenItemNegotiation = vi.fn();
    render(
      <CartPageCard
        basePath="/ogabassey"
        item={sampleItem}
        onOpenItemNegotiation={onOpenItemNegotiation}
      />
    );

    fireEvent.click(screen.getByLabelText('Increase quantity'));
    expect(mockUpdateQuantity).toHaveBeenCalledWith('item-123', 3);

    fireEvent.click(screen.getByLabelText('Decrease quantity'));
    expect(mockUpdateQuantity).toHaveBeenCalledWith('item-123', 1);
  });

  it('calls removeFromCart when delete button is clicked', () => {
    const onOpenItemNegotiation = vi.fn();
    render(
      <CartPageCard
        basePath="/ogabassey"
        item={sampleItem}
        onOpenItemNegotiation={onOpenItemNegotiation}
      />
    );

    fireEvent.click(screen.getByLabelText('Remove item'));
    expect(mockRemoveFromCart).toHaveBeenCalledWith('item-123');
  });

  it('triggers onOpenItemNegotiation when negotiable and hasPriceNegotiation is true', () => {
    const onOpenItemNegotiation = vi.fn();
    render(
      <CartPageCard
        basePath="/ogabassey"
        hasPriceNegotiation={true}
        item={sampleItem}
        onOpenItemNegotiation={onOpenItemNegotiation}
      />
    );

    const negotiateBtn = screen.getByText('Negotiate');
    fireEvent.click(negotiateBtn);
    expect(onOpenItemNegotiation).toHaveBeenCalledWith(sampleItem);
  });

  it('renders Free gift and disables quantity increase for quiz vouchers', () => {
    const onOpenItemNegotiation = vi.fn();
    const quizItem: CartItem = {
      ...sampleItem,
      cartItemId: 'quiz-1',
      price: 0,
      quizAwardId: 'award-1',
      quizVoucherToken: 'token-1',
    };

    render(
      <CartPageCard
        basePath="/ogabassey"
        hasPriceNegotiation={true}
        item={quizItem}
        onOpenItemNegotiation={onOpenItemNegotiation}
      />
    );

    expect(screen.getByText('Free gift')).toBeInTheDocument();
    expect(screen.getByLabelText('Increase quantity')).toBeDisabled();
    expect(screen.queryByText('Negotiate')).not.toBeInTheDocument();
  });

  it('conditionally displays assurance row based on merchant feature flag and context', () => {
    const onOpenItemNegotiation = vi.fn();
    const itemWithoutAssurance = { ...sampleItem, hasAssurance: false };
    const { rerender } = render(
      <CartPageCard
        basePath="/ogabassey"
        item={itemWithoutAssurance}
        onOpenItemNegotiation={onOpenItemNegotiation}
        shippingInsuranceEnabled={false}
        cartMerchantContextMatches={true}
      />
    );

    expect(screen.queryByText('Ogabassey Assurance')).not.toBeInTheDocument();

    rerender(
      <CartPageCard
        basePath="/ogabassey"
        item={itemWithoutAssurance}
        onOpenItemNegotiation={onOpenItemNegotiation}
        shippingInsuranceEnabled={true}
        cartMerchantContextMatches={true}
      />
    );

    expect(screen.getByText('Ogabassey Assurance')).toBeInTheDocument();

    rerender(
      <CartPageCard
        basePath="/ogabassey"
        item={itemWithoutAssurance}
        onOpenItemNegotiation={onOpenItemNegotiation}
        shippingInsuranceEnabled={true}
        cartMerchantContextMatches={false}
      />
    );

    expect(screen.queryByText('Ogabassey Assurance')).not.toBeInTheDocument();
  });
});
