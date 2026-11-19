import { act, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ fetchOrder: vi.fn(), reviews: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/order-success',
  useSearchParams: () => new URLSearchParams({ orderId: 'order-1' }),
}));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ merchant: { slug: 'shop', country: 'NG' } }),
}));
vi.mock('@/hooks/use-currency', () => ({
  useCurrencyWithCountry: () => ({ formatCurrency: String }),
}));
vi.mock(
  '@/components/storefront/ogabassey/pages/checkout/hooks/use-storefront-customer-session',
  () => ({ useStorefrontCustomerSession: () => ({ status: 'guest' }) })
);
vi.mock('@/components/analytics/google-customer-reviews', () => ({
  GoogleCustomerReviews: (props: unknown) => {
    m.reviews(props);
    return null;
  },
}));
vi.mock('./fetch-storefront-order', () => ({
  fetchStorefrontOrderData: m.fetchOrder,
}));
vi.mock('./use-bnpl-settlement', () => ({
  useBnplSettlement: () => undefined,
}));
vi.mock('./use-invoice-generated-capture', () => ({
  useInvoiceGeneratedCapture: () => undefined,
}));
vi.mock('./use-payforme-handoff-refresh', () => ({
  usePayformeHandoffRefresh: () => undefined,
}));
vi.mock('./order-success-invoice-cta', () => ({
  OrderSuccessInvoiceCta: () => null,
}));
vi.mock('./order-success-order-summary', () => ({
  OrderSuccessOrderSummary: () => null,
}));

import { OrderSuccessContent } from './order-success-content';

afterEach(() => vi.restoreAllMocks());

it('calculates the delivery estimate after order details arrive, even across midnight', async () => {
  const now = vi
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-11-01T23:59:59Z'));
  let resolveOrder!: (value: unknown) => void;
  m.fetchOrder.mockReturnValue(
    new Promise((resolve) => {
      resolveOrder = resolve;
    })
  );

  render(<OrderSuccessContent />);
  now.mockReturnValue(Date.parse('2026-11-02T00:00:01Z'));
  await act(async () =>
    resolveOrder({
      id: 'order-1',
      customer_email: 'buyer@example.test',
      items: [],
      total: 100,
    })
  );

  await waitFor(() =>
    expect(m.reviews).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryDate: '2026-11-07' })
    )
  );
});
