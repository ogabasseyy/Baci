import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import { MobileOrderSummary } from './MobileOrderSummary';

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}));

const cartItem = {
  brand: 'Baci',
  cartItemId: 'cart-item-1',
  description: 'A phone',
  gtin: '',
  id: 'product-1',
  image: '/phone.png',
  imageHint: '',
  imageLarge: '/phone.png',
  manage_stock: true,
  mpn: '',
  name: 'Baci Phone',
  price: 120_000,
  quantity: 2,
  status: 'active',
  stock: 5,
} satisfies CartItem;

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({ formatCurrencyAuto: (amount: number) => `₦${amount}`, currencyCode: 'NGN' }),
}));

describe('MobileOrderSummary', () => {
  it('starts collapsed and toggles the breakdown open and closed', () => {
    render(<MobileOrderSummary cart={[]} cartTotal={1000} deliveryCost={0} deliveryMethod="pickup" giftWrappingCost={0} payWithWallet={false} remainingAmount={1000} walletAmountUsed={0} walletBalance={0} />);
    const toggle = screen.getByRole('button', { name: /show order summary/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /hide order summary/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Subtotal')).toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
  it('itemizes the tax included in the Home Makeover payable total', () => {
    render(<MobileOrderSummary cart={[]} cartTotal={7000} deliveryCost={3522} deliveryMethod="door" giftWrappingCost={0} payWithWallet={false} remainingAmount={11047} walletAmountUsed={0} walletBalance={0} taxAmount={525} />);
    fireEvent.click(screen.getByRole('button', { name: /show order summary/i }));
    expect(screen.getByText('Tax')).toBeVisible();
    expect(screen.getByText('₦525')).toBeVisible();
  });

  it('itemizes discounts and wallet credit separately from tax and delivery', () => {
    render(<MobileOrderSummary cart={[]} cartTotal={7000} deliveryCost={2201} deliveryMethod="door" giftWrappingCost={100} payWithWallet remainingAmount={8826} walletAmountUsed={500} walletBalance={500} taxAmount={525} discountAmount={500} />);
    fireEvent.click(screen.getByRole('button', { name: /show order summary/i }));
    expect(screen.getByText('Discount')).toBeVisible();
    expect(screen.getByText('Wallet Credit')).toBeVisible();
    expect(screen.getAllByText('-₦500')).toHaveLength(2);
    expect(screen.getAllByText('₦8826')).toHaveLength(2);
  });
  it('keeps order summary thumbnails on the neutral image surface', () => {
    render(
      <MobileOrderSummary
        cart={[cartItem]}
        cartTotal={240_000}
        deliveryCost={0}
        deliveryMethod="pickup"
        giftWrappingCost={0}
        payWithWallet={false}
        remainingAmount={240_000}
        walletAmountUsed={0}
        walletBalance={0}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /show order summary/i })
    );

    expect(screen.getByAltText('Baci Phone').parentElement).toHaveClass(
      'ogabassey-product-card-image-surface'
    );
    expect(screen.getByAltText('Baci Phone')).toHaveAttribute(
      'src',
      '/phone.png'
    );
  });
});

const summaryProps = { cartTotal: 1000, deliveryCost: 0, deliveryMethod: null, giftWrappingCost: 0, payWithWallet: false, remainingAmount: 1000, walletAmountUsed: 0, walletBalance: 0 };

it('shows Free for resumed orders with zero shipping', () => {
  render(<MobileOrderSummary {...summaryProps} cart={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /show order summary/i }));
  expect(screen.getByText('Free')).toBeVisible();
  expect(screen.queryByText('Calculated at next step')).not.toBeInTheDocument();
});

it('labels a quiz voucher as Free gift instead of its catalog price', () => {
  render(<MobileOrderSummary {...summaryProps} cart={[{ ...cartItem, quizAwardId: 'award', quizVoucherToken: 'voucher' }]} />);
  fireEvent.click(screen.getByRole('button', { name: /show order summary/i }));
  expect(screen.getByText('Free gift')).toBeVisible();
  expect(screen.queryByText('₦120000')).not.toBeInTheDocument();
});

it.each([false, true])('hydrates legacy items without key warnings, including shared product IDs: %s', async (sharedProduct) => {
  const { cartItemId: _cartItemId, ...legacyItem } = { ...cartItem, variantId: 'variant-1' };
  const component = <MobileOrderSummary {...summaryProps} cart={[legacyItem as CartItem, { ...legacyItem, id: sharedProduct ? legacyItem.id : 'product-2', variantId: 'variant-2', name: 'Second phone' } as CartItem]} />;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const container = document.createElement('div');
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    container.innerHTML = renderToString(component);
    document.body.append(container);
    await act(async () => { root = hydrateRoot(container, component); });
    fireEvent.click(screen.getByRole('button', { name: /show order summary/i }));
    expect(screen.getByText('Baci Phone')).toBeVisible();
    expect(screen.getByText('Second phone')).toBeVisible();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    errors.mockRestore();
  }
});
