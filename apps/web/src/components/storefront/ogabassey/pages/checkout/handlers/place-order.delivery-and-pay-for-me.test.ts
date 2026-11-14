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

  describe('PayForMe', () => {
    it('redirects with payer name for payforme payment', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-pfm' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({
        paymentMethod: 'payforme',
        payForMeDetails: {
          name: 'Jane Doe',
          contact: 'jane@example.com',
          note: 'Please pay for me',
        },
      });
      await handlePlaceOrder(opts);

      expect(opts.getHref).toHaveBeenCalledWith(
        expect.stringContaining('type=payforme')
      );
      expect(opts.getHref).toHaveBeenCalledWith(
        expect.stringContaining('payerName=Jane%20Doe')
      );
    });
  });

  describe('Shipping Address Building', () => {
    it('uses saved address when not in new address mode', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-sa' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({
        paymentMethod: 'invoice',
        isNewAddressMode: false,
        selectedAddressId: 1,
        addresses: [
          {
            id: 1,
            label: 'Home',
            address: '5 Allen Ave, Ikeja, Lagos',
            phone: '+2348012345678',
            isDefault: true,
          },
        ],
      });
      await handlePlaceOrder(opts);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.shipping_address.address).toBe(
        '5 Allen Ave, Ikeja, Lagos'
      );
    });

    it('uses pickup address for pickup delivery', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-pk' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({
        paymentMethod: 'invoice',
        deliveryMethod: 'pickup',
      });
      await handlePlaceOrder(opts);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.shipping_address.address).toBe('Pickup at Store');
      // B3 (plan §5 B3): pickup is a delivery-method label, not a
      // third-party shipping provider. Sending 'Pickup' would trip the
      // RPC's `shipping_quote_required` guard. The handler now sends
      // `shipping_provider: null` for pickup; the delivery method is
      // carried by `shipping_address.address: 'Pickup at Store'`.
      expect(fetchBody.shipping_provider).toBeNull();
      // B3 review fix (PR #1611): the paired B3 field MUST also be
      // null on the wire — partial-payload regressions (e.g., only
      // one field flipped to null) would re-open the RPC-guard
      // bypass vector. Pin both fields in lockstep.
      expect(fetchBody.selected_quote_id).toBeNull();
    });

    it('uses provider quote details for GIGL pickup station delivery', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-station' },
          wallet: null,
          amountDueToGateway: 14_493,
        }),
      });

      const opts = buildOpts({
        deliveryCost: 4493,
        deliveryMethod: 'pickup_station',
        selectedQuoteId: 'station-quote',
        shippingQuotes: [
          {
            id: 'station-quote',
            provider: 'GIGL',
            serviceTier: 'station',
            carrierName: 'GIG Logistics',
            displayName: 'Pickup Stations (GIGL)',
            price: 4493,
            estimatedDays: 3,
            currency: 'NGN',
            pickupIncluded: true,
            insuranceIncluded: true,
            isStationPickup: true,
            stationName: 'PORT HARCOURT',
            stationAddress: 'GIGL Aba Road, Port Harcourt',
          },
        ],
      });
      await handlePlaceOrder(opts);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.shipping_provider).toBe('GIGL');
      expect(fetchBody.selected_quote_id).toBe('station-quote');
      expect(fetchBody.shipping_address.address).toBe(
        'PORT HARCOURT, GIGL Aba Road, Port Harcourt'
      );
    });

    it('omits shipping_provider for airport delivery (B3 — delivery-method labels are not providers)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-ap' },
          wallet: null,
          amountDueToGateway: 5000,
        }),
      });

      const opts = buildOpts({
        paymentMethod: 'invoice',
        deliveryMethod: 'airport',
      });
      await handlePlaceOrder(opts);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.shipping_provider).toBeNull();
      // B3 review fix (PR #1611): paired-field lockstep, same as pickup.
      expect(fetchBody.selected_quote_id).toBeNull();
    });
  });
});
