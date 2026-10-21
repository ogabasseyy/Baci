import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SuccessPageContent } from './client-page';

const merchantMock = vi.hoisted(() => ({
  merchant: { country: 'NG' } as { country: string } | null,
}));

vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({ merchant: merchantMock.merchant }),
}));

vi.mock('@/components/themed', () => ({
  ThemedButton: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) =>
    createElement('img', { alt, src }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

describe('checkout success client page', () => {
  beforeEach(() => {
    merchantMock.merchant = { country: 'NG' };
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  const order = {
    order_number: 'BAC-1001',
    shipping: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      address: '1 Algorithm Lane',
      city: 'Lagos',
      state: 'LA',
    },
    items: [
      {
        id: 'item-1',
        name: 'Wireless Charger',
        price: 2000,
        quantity: 2,
        image: '/charger.jpg',
      },
    ],
    shipping_fee: 0,
  };

  it('renders a safe empty state without malformed thank-you text', () => {
    render(<SuccessPageContent />);

    expect(screen.getByText('Order Confirmed!')).toBeInTheDocument();
    expect(
      screen.queryByText(/Thank you for your purchase/i)
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Continue Shopping' })
    ).toHaveAttribute('href', '/');
  });

  it('renders order details with derived totals and zero shipping preserved', () => {
    sessionStorage.setItem('lastOrder', JSON.stringify(order));

    render(<SuccessPageContent />);

    expect(screen.getByText('Order BAC-1001')).toBeInTheDocument();
    expect(
      screen.getByText(/Thank you for your purchase, Ada/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Thank you for your purchase, Ada/i)
    ).toHaveAttribute('data-ph-block');
    expect(screen.getByText('Shipping To').closest('[data-ph-block]')).not.toBe(
      null
    );
    expect(screen.getByText(/ada@example.com/i)).toBeInTheDocument();
    expect(screen.getByText('Wireless Charger')).toBeInTheDocument();
    expect(screen.getByText('₦0.00')).toBeInTheDocument();
    expect(screen.getAllByText('₦4,000.00')).toHaveLength(3);
  });

  it('falls back to USD when merchant country is unavailable', () => {
    merchantMock.merchant = null;
    sessionStorage.setItem(
      'lastOrder',
      JSON.stringify({ ...order, shipping_fee: 5, total: 4005 })
    );

    render(<SuccessPageContent />);

    expect(screen.getAllByText('$4,000.00')).toHaveLength(2);
    expect(screen.getByText('$5.00')).toBeInTheDocument();
    expect(screen.getByText('$4,005.00')).toBeInTheDocument();
  });
});
