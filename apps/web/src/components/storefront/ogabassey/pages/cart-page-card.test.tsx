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
  price: 1500000,
  quantity: 2,
  condition: 'brand_new',
  image: 'https://example.com/iphone.jpg',
  brand: 'Apple',
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

  it('triggers onOpenItemNegotiation when negotiable', () => {
    const onOpenItemNegotiation = vi.fn();
    render(
      <CartPageCard
        basePath="/ogabassey"
        item={sampleItem}
        onOpenItemNegotiation={onOpenItemNegotiation}
      />
    );

    const negotiateBtn = screen.getByText('Negotiate');
    fireEvent.click(negotiateBtn);
    expect(onOpenItemNegotiation).toHaveBeenCalledWith(sampleItem);
  });
});
