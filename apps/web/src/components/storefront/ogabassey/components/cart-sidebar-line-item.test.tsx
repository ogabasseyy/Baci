import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/routes', () => ({
  asRoute: (path: string) => path,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, preload: _preload, ...rest } = props;
    return <img {...rest} alt={String(props.alt || '')} />;
  },
}));

import type { CartItem } from '@/hooks/cart';
import { CartSidebarLineItem } from './cart-sidebar-line-item';

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    cartItemId: 'line-1',
    id: 'prod-1',
    name: 'iPhone 15',
    brand: 'Apple',
    price: 500000,
    quantity: 2,
    image: '/iphone.png',
    ...overrides,
  } as CartItem;
}

function setup(
  item: CartItem = makeItem(),
  overrides: Partial<React.ComponentProps<typeof CartSidebarLineItem>> = {}
) {
  const onRemove = vi.fn();
  const onUpdateQuantity = vi.fn();
  const onNegotiate = vi.fn();
  const onToggleAssurance = vi.fn();
  render(
    <CartSidebarLineItem
      item={item}
      basePath="/acme"
      hasPriceNegotiation
      cartMerchantContextMatches
      merchantSlug="acme"
      shippingInsuranceEnabled
      onRemove={onRemove}
      onUpdateQuantity={onUpdateQuantity}
      onNegotiate={onNegotiate}
      onToggleAssurance={onToggleAssurance}
      {...overrides}
    />
  );
  return { onRemove, onUpdateQuantity, onNegotiate, onToggleAssurance };
}

describe('CartSidebarLineItem', () => {
  it('renders the line details and wires quantity and remove actions', () => {
    const { onRemove, onUpdateQuantity } = setup();

    const productLinks = screen.getAllByRole('link', { name: 'iPhone 15' });
    expect(productLinks).toHaveLength(2);
    for (const link of productLinks) {
      expect(link).toHaveAttribute('href', expect.stringContaining('/acme'));
    }
    // 500,000 x 2
    expect(screen.getByText('₦1,000,000')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove item' }));
    expect(onRemove).toHaveBeenCalledWith('line-1');

    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(onUpdateQuantity).toHaveBeenCalledWith('line-1', 3);

    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(onUpdateQuantity).toHaveBeenCalledWith('line-1', 1);
  });

  it('disables decrease at quantity 1', () => {
    setup(makeItem({ quantity: 1 }));

    expect(
      screen.getByRole('button', { name: 'Decrease quantity' })
    ).toBeDisabled();
  });

  it('offers negotiation for negotiable lines', () => {
    const { onNegotiate } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Negotiate' }));
    expect(onNegotiate).toHaveBeenCalledTimes(1);
    expect(onNegotiate.mock.calls[0][0]).toMatchObject({
      cartItemId: 'line-1',
    });
  });

  it('shows Best price for non-negotiable lines', () => {
    setup(makeItem({ brand: 'Samsung', name: 'Galaxy A54' }));

    expect(screen.getByText('Best price')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Negotiate' })
    ).not.toBeInTheDocument();
  });

  it('shows the accepted badge for negotiated lines', () => {
    setup(
      makeItem({ negotiationStatus: 'accepted', negotiatedPrice: 450000 })
    );

    expect(screen.getByText(/Matched @/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Negotiate' })
    ).not.toBeInTheDocument();
  });

  it('shows Free gift for quiz voucher lines', () => {
    setup(makeItem({ quizAwardId: 'award-1', quizVoucherToken: 'tok' }));

    expect(screen.getByText('Free gift')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Negotiate' })
    ).not.toBeInTheDocument();
  });

  it('toggles assurance and labels it per merchant', () => {
    const { onToggleAssurance } = setup();

    expect(screen.getByText('Order Protection')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleAssurance).toHaveBeenCalledWith('line-1');
  });

  it('uses the Ogabassey assurance label for the ogabassey tenant', () => {
    setup(makeItem(), { merchantSlug: 'ogabassey' });

    expect(screen.getByText('Ogabassey Assurance')).toBeInTheDocument();
  });

  it('hides assurance when the merchant context does not match', () => {
    setup(makeItem(), { cartMerchantContextMatches: false });

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
