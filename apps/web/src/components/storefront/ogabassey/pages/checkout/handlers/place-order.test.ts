import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlaceOrder } from './place-order';

// Mock dependencies
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/credpal', () => ({
  openCredPalCheckout: vi.fn(),
}));

vi.mock('@/lib/credit-direct-client', () => ({
  openCreditDirectCheckout: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  })),
}));

import { buildOpts, mockFetch } from './place-order.test-helpers';

global.fetch = mockFetch;

describe('handlePlaceOrder', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mockFetch.mockReset();
    window.sessionStorage.clear();
  });

  describe('Validation', () => {
    it('returns early on double-submit', async () => {
      const opts = buildOpts({
        isOrderInFlightRef: { current: true },
      });
      await handlePlaceOrder(opts);
      expect(opts.setIsProcessing).not.toHaveBeenCalled();
    });

    it('shows error toast when merchant is missing', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({ merchant: null });
      await handlePlaceOrder(opts);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' })
      );
      expect(opts.isOrderInFlightRef.current).toBe(false);
    });

    it('shows error toast when name/email is missing', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({ firstName: '' });
      await handlePlaceOrder(opts);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Missing Information' })
      );
    });

    it('shows error toast for incomplete door delivery address', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({ newAddressStreet: '' });
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      await handlePlaceOrder(opts);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Incomplete Address' })
      );
    });

    // B3 review fix #2 (PR #1611): door delivery without ANY quote
    // must NOT submit. Pre-fix the handler sent `shipping_provider:
    // null + selected_quote_id: null`, which slipped past the RPC's
    // `provider != null AND quote_id IS NULL` guard (both null →
    // guard doesn't fire) and silently persisted a zero-shipping
    // order. The RPC predicate alone can't tell legitimate pickup
    // (no provider, no quote) from broken door-no-quote — the client
    // is the right place to enforce.
    it('shows error toast when door delivery has no selected quote at all', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({
        deliveryMethod: 'door',
        selectedQuoteId: '', // pristine: user never picked a quote
        shippingQuotes: [
          {
            id: 'q-fresh',
            provider: 'GIGL',
            serviceTier: 'standard',
            carrierName: 'GIG Logistics',
            displayName: 'Standard',
            price: 2000,
            estimatedDays: 3,
            currency: 'NGN',
            pickupIncluded: false,
            insuranceIncluded: false,
          },
        ],
      });
      await handlePlaceOrder(opts);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delivery option required' })
      );
      // Critical: the order never reaches /api/orders. Pre-fix it would
      // have POSTed `shipping_provider: null + selected_quote_id: null`
      // and got back a silent 200 with zero shipping fee attached.
      expect(mockFetch).not.toHaveBeenCalled();
      expect(opts.isOrderInFlightRef.current).toBe(false);
      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
    });

    // B3 review fix #1 (PR #1611): door delivery with a selectedQuoteId
    // that no longer exists in `shippingQuotes` (rates refreshed or
    // expired) must NOT fabricate a 'Standard' provider — the order
    // would persist with a phony provider and dangling quote id,
    // sneaking past the new RPC guard. The handler bails with a
    // validation toast so the customer re-picks from fresh rates.
    it('shows error toast when door delivery references a quote id that no longer resolves', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const opts = buildOpts({
        deliveryMethod: 'door',
        selectedQuoteId: 'q-expired-and-refreshed',
        // Quote list has a different id (e.g. user reopened the
        // tab and rates were re-fetched, but the stored
        // selectedQuoteId in their session is stale).
        shippingQuotes: [
          {
            id: 'q-fresh',
            provider: 'GIGL',
            serviceTier: 'standard',
            carrierName: 'GIG Logistics',
            displayName: 'Standard',
            price: 2000,
            estimatedDays: 3,
            currency: 'NGN',
            pickupIncluded: false,
            insuranceIncluded: false,
          },
        ],
      });
      await handlePlaceOrder(opts);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Shipping rate expired' })
      );
      expect(mockFetch).not.toHaveBeenCalled();
      expect(opts.isOrderInFlightRef.current).toBe(false);
      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
    });
  });
});
