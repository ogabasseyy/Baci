import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseParams = vi.fn();
const mockUseSearchParams = vi.fn();
const mockUseMerchant = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock('@/hooks/merchant', () => ({
  useMerchant: () => mockUseMerchant(),
}));

import TrackOrderPage from './page';

describe('TrackOrderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ slug: 'shop.localhost' });
    mockUseSearchParams.mockReturnValue(new URLSearchParams('token=tok-123'));
    mockUseMerchant.mockReturnValue({ merchant: { slug: 'shop' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits the resolved merchant slug rather than a subdomain hostname on token lookups', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        order: {
          id: 'ord-1',
          order_number: 'ORD-1',
          status: 'pending',
          payment_status: 'paid',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          subtotal: 1000,
          shipping_cost: 0,
          discount_amount: 0,
          total: 1000,
          currency: 'NGN',
        },
        customer: { name: 'Ada', email: 'ada@example.com', phone: '0800' },
        shipping_address: {
          address: '1 Main',
          city: 'Lagos',
          state: 'LA',
          country: 'NG',
        },
        items: [],
        timeline: [],
        shipping_tracking: null,
        estimated_delivery: null,
        merchant: { name: 'Shop' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<TrackOrderPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain('merchant_slug=shop');
    expect(requestedUrl).not.toContain('shop.localhost');
  });
});
