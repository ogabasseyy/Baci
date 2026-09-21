import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush, back: vi.fn(), replace: vi.fn() })),
  useSearchParams: vi.fn(() => mockSearchParams),
  usePathname: vi.fn(() => '/ogabassey/order-success'),
}));

vi.mock('next/link', () => ({
  default: vi.fn(({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  )),
}));

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: vi.fn(() => ({
    isAuthenticated: false,
    customer: null,
  })),
}));

vi.mock('../providers/v2-order-context', () => ({
  useV2Order: vi.fn(() => ({
    getOrder: vi.fn(() => undefined),
  })),
}));

vi.mock('../components/InvoiceModal', () => ({
  InvoiceModal: vi.fn(() => null),
}));

import { useSearchParams } from 'next/navigation';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { BACI_GOOGLE_REVIEW_URL } from '@/lib/post-purchase-actions';
import { OrderSuccessPage } from './order-success-page';

function setSearchParams(params: Record<string, string>) {
  const sp = new URLSearchParams(params);
  vi.mocked(useSearchParams).mockReturnValue(sp as unknown as ReturnType<typeof useSearchParams>);
}

describe('OrderSuccessPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    vi.mocked(useCustomerAuth).mockReturnValue({
      isAuthenticated: false,
    } as ReturnType<typeof useCustomerAuth>);
  });

  it('renders order not found when no orderId', () => {
    setSearchParams({});
    render(<OrderSuccessPage />);
    expect(screen.getByText('Order not found')).toBeTruthy();
  });

  it('renders success page with order ID', () => {
    setSearchParams({ orderId: 'abc-123', type: 'standard' });
    render(<OrderSuccessPage />);
    expect(screen.getByText('Order Successful!')).toBeTruthy();
    expect(screen.getByText('Order #abc-123')).toBeTruthy();
  });

  it('links the Google review CTA to the external review destination', () => {
    setSearchParams({ orderId: 'review-1', type: 'standard' });
    render(<OrderSuccessPage />);

    const reviewLink = screen.getByRole('link', {
      name: /leave a google review/i,
    });
    expect(reviewLink).toHaveAttribute('href', BACI_GOOGLE_REVIEW_URL);
    expect(reviewLink).toHaveAttribute('target', '_blank');
  });

  it('renders invoice title for invoice type', () => {
    setSearchParams({ orderId: 'inv-1', type: 'invoice' });
    render(<OrderSuccessPage />);
    expect(screen.getByText('Proforma Invoice Ready!')).toBeTruthy();
  });

  it('renders payforme share prompt with payer name', () => {
    setSearchParams({ orderId: 'pay-1', type: 'payforme', payerName: 'Alice' });
    render(<OrderSuccessPage />);
    expect(screen.getByText('Share the Payment Link')).toBeTruthy();
    expect(
      screen.getByText(/send the payment link below to Alice/i),
    ).toBeTruthy();
    // The handoff contract: the requester forwards the link — the page
    // must never claim a delivery happened.
    expect(screen.queryByText(/we've sent a payment link/i)).toBeNull();
    expect(screen.queryByText('Request Sent!')).toBeNull();
  });

  it('hands the requester a copyable payer link for payforme orders', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    setSearchParams({
      orderId: 'pay-1',
      type: 'payforme',
      payerName: 'Alice',
      trackingToken: 'track-1',
    });
    render(<OrderSuccessPage />);

    const linkInput = screen.getByLabelText(
      /payment link to share with your payer/i
    ) as HTMLInputElement;
    expect(linkInput.value).toContain('/track-order?token=track-1');

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(linkInput.value);
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it.each(['credit_direct', 'credpal', 'klump'])(
    'renders BNPL pending approval language for %s',
    (type) => {
      setSearchParams({ orderId: 'bnpl-1', type });
      render(<OrderSuccessPage />);

      expect(
        screen.getByRole('heading', { name: /bnpl checkout submitted/i })
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /we will confirm your order after the provider approves the payment/i
        )
      ).toBeInTheDocument();
    }
  );

  it('guest with trackingToken navigates to track-order page', () => {
    setSearchParams({ orderId: 'ord-1', trackingToken: 'tok_abc123' });
    vi.mocked(useCustomerAuth).mockReturnValue({
      isAuthenticated: false,
    } as ReturnType<typeof useCustomerAuth>);

    render(<OrderSuccessPage />);

    const btn = screen.getByRole('button', { name: /see order details/i });
    fireEvent.click(btn);

    expect(mockPush).toHaveBeenCalledWith(
      '/ogabassey/track-order?token=tok_abc123',
    );
  });

  it('authenticated user navigates to account/orders', () => {
    setSearchParams({ orderId: 'ord-2', trackingToken: 'tok_xyz' });
    vi.mocked(useCustomerAuth).mockReturnValue({
      isAuthenticated: true,
    } as ReturnType<typeof useCustomerAuth>);

    render(<OrderSuccessPage />);

    const btn = screen.getByRole('button', { name: /see order details/i });
    fireEvent.click(btn);

    expect(mockPush).toHaveBeenCalledWith('/ogabassey/account/orders');
  });

  it('guest without trackingToken navigates to account/orders', () => {
    setSearchParams({ orderId: 'ord-3' });
    vi.mocked(useCustomerAuth).mockReturnValue({
      isAuthenticated: false,
    } as ReturnType<typeof useCustomerAuth>);

    render(<OrderSuccessPage />);

    const btn = screen.getByRole('button', { name: /see order details/i });
    fireEvent.click(btn);

    expect(mockPush).toHaveBeenCalledWith('/ogabassey/account/orders');
  });
});
