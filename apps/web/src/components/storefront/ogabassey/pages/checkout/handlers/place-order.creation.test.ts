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

  describe('Order Creation', () => {
    it('creates an order via POST /api/orders', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'new-order-1' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts();
      await handlePlaceOrder(opts);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/orders',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('includes B3.5 VAT + gift wrapping + parity fields in the POST body', async () => {
      // Codex P1 (PR #1622): the handler must propagate the
      // calculate-commerce VAT figure, the gift wrap, and the
      // client's expected_total/client_total so the RPC's parity
      // check (Δ-42 + Δ-39) has a non-NULL value to compare
      // against. Without this assertion a future refactor that
      // drops one of these fields would silently revert B3.5's
      // fail-closed semantics — the RPC would default tax_amount
      // to 0 and the parity check would never run.
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'new-order-b35' },
          wallet: null,
          amountDueToGateway: 12500,
        }),
      });

      const opts = buildOpts({
        taxAmount: 500,
        giftWrappingCost: 300,
        cartTotal: 10000,
        deliveryCost: 2000,
        total: 12800,
      });
      await handlePlaceOrder(opts);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody).toEqual(
        expect.objectContaining({
          tax_amount: 500,
          tax_basis: 'exclusive',
          gift_wrapping_fee: 300,
          expected_total: 12800,
          client_total: 12800,
        })
      );
    });

    it('includes variantId and variantAttributes in order items', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-variant' },
          wallet: null,
          amountDueToGateway: 720000,
        }),
      });

      const opts = buildOpts({
        cart: [
          {
            id: 'p-variant',
            name: 'MacBook Air M1',
            quantity: 1,
            price: 720000,
            variantId: 'variant-256gb',
            variantAttributes: { storage: '256GB', color: 'Space Gray' },
            hasAssurance: false,
          },
        ],
        cartTotal: 720000,
        total: 720000,
      });
      await handlePlaceOrder(opts);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.items[0]).toEqual(
        expect.objectContaining({
          variantId: 'variant-256gb',
          variantAttributes: { storage: '256GB', color: 'Space Gray' },
        })
      );
    });

    it('uses the selected saved address for payment billing after leaving new address mode', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            order: { id: 'order-paystack' },
            wallet: null,
            amountDueToGateway: 12000,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            authorization_url: 'https://paystack.test/checkout',
          }),
        });

      const opts = buildOpts({
        paymentMethod: 'paystack',
        isNewAddressMode: false,
        newAddressStreet: 'Stale Manual Street',
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

      const initBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(initBody.billing_address).toEqual(
        expect.objectContaining({
          line1: '5 Allen Ave, Ikeja, Lagos',
          city: 'Ikeja',
          state: 'Lagos',
          country: 'NG',
        })
      );
      // Currency threaded from the merchant-resolved code, not hardcoded.
      expect(initBody.currency).toBe('NGN');
    });

    it('threads the merchant-resolved currency into payment initialization', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            order: { id: 'order-kes' },
            wallet: null,
            amountDueToGateway: 12000,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            authorization_url: 'https://paystack.test/checkout',
          }),
        });

      const opts = buildOpts({
        paymentMethod: 'paystack',
        currency: 'KES',
      });
      await handlePlaceOrder(opts);

      const initBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(initBody.currency).toBe('KES');
    });

    it('throws on failed order creation', async () => {
      const { toast } = await import('@/hooks/use-toast');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      });

      const opts = buildOpts();
      await handlePlaceOrder(opts);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Checkout Failed' })
      );
      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
    });

    // FIX C + FIX E: a rejected quiz-prize voucher must surface friendly copy
    // (not the raw RPC code) AND prune the offending line so it stops
    // re-failing every checkout.
    it('prunes the voucher line and shows friendly copy when the voucher is rejected', async () => {
      const { toast } = await import('@/hooks/use-toast');
      const pruneVoucherLines = vi.fn();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Failed to create order',
          details: 'quiz_voucher_award_not_approved',
          rejectedVoucherToken: 'qv1.rejected.signature',
        }),
      });

      const opts = buildOpts({ pruneVoucherLines });
      await handlePlaceOrder(opts);

      expect(pruneVoucherLines).toHaveBeenCalledWith('qv1.rejected.signature');
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Checkout Failed',
          description:
            "This prize isn't available to redeem yet. Please contact support.",
        })
      );
    });

    it('does not prune voucher lines for a non-voucher order error', async () => {
      const pruneVoucherLines = vi.fn();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Failed to create order',
          details: 'order_total_mismatch',
        }),
      });

      const opts = buildOpts({ pruneVoucherLines });
      await handlePlaceOrder(opts);

      expect(pruneVoucherLines).not.toHaveBeenCalled();
    });
  });
});
