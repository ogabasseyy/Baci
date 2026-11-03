import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks for the modules that the executors call into. Keep the
// scope narrow: we test buildScriptExecutors's WIRING, not the boundary
// integrations themselves (sendEmail, triggerPurchaseConversion, and
// the settlement RPC each have their own colocated tests).
const sendEmailMock = vi.hoisted(() => vi.fn());
const triggerPurchaseConversionMock = vi.hoisted(() => vi.fn());
const calculatePlatformFeeMock = vi.hoisted(() =>
  vi.fn(() => ({ platformFee: 0, baseAmount: 0 }))
);
const extractVerifiedGatewayFeeNgnMock = vi.hoisted(() => vi.fn(() => 300));
const getRootDomainMock = vi.hoisted(() => vi.fn(() => 'usebaci.com'));
const generateEmailMock = vi.hoisted(() => vi.fn(() => '<html />'));
const generateTextMock = vi.hoisted(() => vi.fn(() => 'plain text'));

vi.mock('@/lib/zeptomail', () => ({ sendEmail: sendEmailMock }));
vi.mock('@/lib/trigger-purchase-conversion', () => ({
  triggerPurchaseConversion: triggerPurchaseConversionMock,
}));
vi.mock('@/lib/paystack', () => ({
  calculatePlatformFee: calculatePlatformFeeMock,
}));
vi.mock('@/lib/payments/verified-gateway-fee', () => ({
  extractVerifiedGatewayFeeNgn: extractVerifiedGatewayFeeNgnMock,
}));
vi.mock('@/env', () => ({ getRootDomain: getRootDomainMock }));
vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: generateEmailMock,
  generateOrderConfirmationText: generateTextMock,
}));

import {
  buildScriptExecutors,
  type RichOrder,
} from '@/scripts/reconcile-paystack-dva-executors';

function richOrder(overrides: Partial<RichOrder> = {}): RichOrder {
  return {
    id: 'order-1',
    merchant_id: 'merchant-1',
    payment_status: 'paid',
    tax_basis: 'exclusive',
    subtotal: 1000,
    shipping_fee: 50,
    gift_wrapping_fee: 0,
    tax_amount: 75,
    discount_amount: 0,
    total: 1125,
    customer_email: 'buyer@example.com',
    customer_name: 'Buyer Name',
    customer_id: 'cust-1',
    customer_phone: '+2348000000000',
    order_number: 'ORD-1',
    shipping_address: { address: '1 Lekki', city: 'Lagos', state: 'Lagos' },
    order_items: [],
    ...overrides,
  };
}

const merchantDetails = {
  business_name: 'Ogabassey',
  slug: 'ogabassey',
  support_email: 'support@ogabassey.com',
  email_sender_name: 'Ogabassey',
  email: 'support@ogabassey.com',
  tax_identification_number: null,
  cac_rc_number: null,
};

const defaultArgs = () => ({
  // Supabase mock: rpc is the only method actually called by settlementExecutor
  supabase: {
    rpc: vi.fn().mockResolvedValue({ error: null }),
  } as never,
  richOrder: richOrder(),
  order: {
    id: 'order-1',
    merchant_id: 'merchant-1',
    payment_status: 'paid' as const,
    tax_basis: 'exclusive' as const,
    subtotal: 1000,
    shipping_fee: 50,
    gift_wrapping_fee: 0,
    tax_amount: 75,
    discount_amount: 0,
    total: 1125,
  },
  transaction: {
    id: 'txn-1',
    order_id: 'order-1',
    merchant_id: 'merchant-1',
    gateway_reference: 'BAC-XYZ',
    amount: 1125,
  },
  paystackReference: '100000000',
  merchantDetails,
  merchantFetchError: null as unknown,
  rawPlatformFee: 25,
  actor: 'script:test',
});

describe('buildScriptExecutors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1' });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns executors for all 5 outbox steps', () => {
    const ex = buildScriptExecutors(defaultArgs());
    expect(typeof ex.paid_email).toBe('function');
    expect(typeof ex.ad_tracking_conversion).toBe('function');
    expect(typeof ex.merchant_settlement).toBe('function');
    expect(typeof ex.firs_invoice).toBe('function');
    expect(typeof ex.loyalty_points).toBe('function');
  });

  const stepCtx = {
    order: defaultArgs().order,
    transaction: defaultArgs().transaction,
    gatewayResponse: {},
    consistency: { consistent: true, detail: null } as never,
  };

  describe('paid_email', () => {
    it('throws merchant_fetch_error when merchantFetchError is set', async () => {
      const ex = buildScriptExecutors({
        ...defaultArgs(),
        merchantFetchError: { message: 'rls hiccup' },
      });
      await expect(ex.paid_email!(stepCtx)).rejects.toThrow(/merchant_fetch_error: rls hiccup/);
    });

    it('skips with missing_merchant_or_customer_email when merchantDetails is null', async () => {
      const ex = buildScriptExecutors({
        ...defaultArgs(),
        merchantDetails: null,
      });
      await expect(ex.paid_email!(stepCtx)).resolves.toEqual({
        skipped: 'missing_merchant_or_customer_email',
      });
    });

    it('skips with missing_merchant_slug when slug is null (Δ-92)', async () => {
      const ex = buildScriptExecutors({
        ...defaultArgs(),
        merchantDetails: { ...merchantDetails, slug: null },
      });
      await expect(ex.paid_email!(stepCtx)).resolves.toEqual({
        skipped: 'missing_merchant_slug',
      });
    });

    it('sends the email and returns messageId on success', async () => {
      const ex = buildScriptExecutors(defaultArgs());
      const result = await ex.paid_email!(stepCtx);
      expect(result).toEqual({ messageId: 'm-1' });
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'buyer@example.com',
          clientReference: 'order:order-1:paid_email',
        })
      );
    });

    it('throws when sendEmail returns failure', async () => {
      sendEmailMock.mockResolvedValueOnce({ success: false, error: 'rate_limited' });
      const ex = buildScriptExecutors(defaultArgs());
      await expect(ex.paid_email!(stepCtx)).rejects.toThrow(/rate_limited/);
    });
  });

  describe('ad_tracking_conversion', () => {
    it('passes the richOrder through to triggerPurchaseConversion', async () => {
      const ex = buildScriptExecutors(defaultArgs());
      const result = await ex.ad_tracking_conversion!(stepCtx);
      expect(result).toEqual({});
      expect(triggerPurchaseConversionMock).toHaveBeenCalledWith(
        expect.anything(),
        'merchant-1',
        expect.objectContaining({ id: 'order-1', total: 1125 })
      );
    });
  });

  describe('merchant_settlement', () => {
    // A Baci-owned DVA: Paystack shows no subaccount, so the credit stays a
    // wallet credit marked as Baci-collected.
    const baciCollectedCtx = { ...stepCtx, gatewayResponse: { subaccount: {} } };

    it('passes the gateway_reference as BAC-* (Δ-22 invariant) and metadata.paystack_reference', async () => {
      const args = defaultArgs();
      const ex = buildScriptExecutors(args);
      await ex.merchant_settlement!(baciCollectedCtx);
      expect(args.supabase.rpc).toHaveBeenCalledWith(
        'record_merchant_settlement',
        expect.objectContaining({
          p_gateway: 'paystack',
          p_gateway_reference: 'BAC-XYZ',
          p_metadata: expect.objectContaining({
            paystack_reference: '100000000',
          }),
        })
      );
    });

    it('falls back to paystackReference when transaction.gateway_reference is null', async () => {
      const args = {
        ...defaultArgs(),
        transaction: {
          ...defaultArgs().transaction,
          gateway_reference: null,
        },
      };
      const ex = buildScriptExecutors(args);
      await ex.merchant_settlement!(baciCollectedCtx);
      expect(args.supabase.rpc).toHaveBeenCalledWith(
        'record_merchant_settlement',
        expect.objectContaining({ p_gateway_reference: '100000000' })
      );
    });

    it('preserves legitimate zero rawPlatformFee instead of falling back (Δ-94 mirror)', async () => {
      const args = { ...defaultArgs(), rawPlatformFee: 0 };
      const ex = buildScriptExecutors(args);
      await ex.merchant_settlement!(baciCollectedCtx);
      expect(args.supabase.rpc).toHaveBeenCalledWith(
        'record_merchant_settlement',
        expect.objectContaining({ p_platform_fee: 0 })
      );
      expect(calculatePlatformFeeMock).not.toHaveBeenCalled();
    });

    it('falls back to calculatePlatformFee when rawPlatformFee is null', async () => {
      calculatePlatformFeeMock.mockReturnValueOnce({
        platformFee: 2050,
        baseAmount: 0,
      });
      const args = { ...defaultArgs(), rawPlatformFee: null };
      const ex = buildScriptExecutors(args);
      await ex.merchant_settlement!(baciCollectedCtx);
      expect(calculatePlatformFeeMock).toHaveBeenCalled();
      expect(args.supabase.rpc).toHaveBeenCalledWith(
        'record_merchant_settlement',
        expect.objectContaining({ p_platform_fee: 20.5 })
      );
    });

    it('throws when the settlement RPC errors', async () => {
      const args = defaultArgs();
      (args.supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        error: { message: 'permission denied' },
      });
      const ex = buildScriptExecutors(args);
      await expect(ex.merchant_settlement!(baciCollectedCtx)).rejects.toThrow(/permission denied/);
    });

    it('marks a Baci-collected DVA reconcile credit so it stays spendable', async () => {
      const args = defaultArgs();
      const ex = buildScriptExecutors(args);
      await ex.merchant_settlement!(baciCollectedCtx);
      expect(args.supabase.rpc).toHaveBeenCalledWith(
        'record_merchant_settlement',
        expect.objectContaining({
          p_metadata: expect.objectContaining({
            paystack_collection: 'integration',
          }),
        })
      );
    });

    it('records a subaccount-split DVA reconcile as direct-settled history, not a wallet credit', async () => {
      const args = defaultArgs();
      const ex = buildScriptExecutors(args);
      await ex.merchant_settlement!({
        ...stepCtx,
        gatewayResponse: {
          amount: 5_030_000,
          fees_split: { integration: 0, paystack: 30_000, subaccount: 5_000_000 },
          subaccount: { subaccount_code: 'ACCT_store' },
        },
      });
      expect(args.supabase.rpc).toHaveBeenCalledWith(
        'record_paystack_direct_split_settlement',
        expect.objectContaining({ p_paystack_subaccount_code: 'ACCT_store' })
      );
      expect(args.supabase.rpc).not.toHaveBeenCalledWith(
        'record_merchant_settlement',
        expect.anything()
      );
    });

    describe('bugfix: GIGL customer-checkout orders must use the GIGL settlement RPCs', () => {
      const giglOrder = () =>
        richOrder({
          shipping_provider: ' gigl ',
          shipping_funding_source: 'customer_checkout',
        });
      const splitCtx = {
        ...stepCtx,
        gatewayResponse: {
          amount: 5_030_000,
          fees_split: { integration: 0, paystack: 30_000, subaccount: 5_000_000 },
          subaccount: { subaccount_code: 'ACCT_store' },
        },
      };

      it('routes a split payload to record_paystack_direct_split_settlement_gigl_v1', async () => {
        const args = { ...defaultArgs(), richOrder: giglOrder() };
        const ex = buildScriptExecutors(args);
        await ex.merchant_settlement!(splitCtx);
        expect(args.supabase.rpc).toHaveBeenCalledWith(
          'record_paystack_direct_split_settlement_gigl_v1',
          expect.objectContaining({ p_paystack_subaccount_code: 'ACCT_store' })
        );
      });

      it('routes a Baci-collected payload to record_merchant_settlement_gigl_v1', async () => {
        const args = { ...defaultArgs(), richOrder: giglOrder() };
        const ex = buildScriptExecutors(args);
        await ex.merchant_settlement!({ ...stepCtx, gatewayResponse: { subaccount: {} } });
        expect(args.supabase.rpc).toHaveBeenCalledWith(
          'record_merchant_settlement_gigl_v1',
          expect.objectContaining({
            p_metadata: expect.objectContaining({ paystack_collection: 'integration' }),
          })
        );
      });

      it('keeps the non-GIGL RPC for a GIGL provider without an economics snapshot', async () => {
        const args = {
          ...defaultArgs(),
          richOrder: richOrder({ shipping_provider: 'GIGL', shipping_funding_source: null }),
        };
        const ex = buildScriptExecutors(args);
        await ex.merchant_settlement!({ ...stepCtx, gatewayResponse: { subaccount: {} } });
        expect(args.supabase.rpc).toHaveBeenCalledWith(
          'record_merchant_settlement',
          expect.anything()
        );
      });
    });

    it('refuses to credit when the verified payload proves neither collection mode', async () => {
      const args = defaultArgs();
      const ex = buildScriptExecutors(args);
      await expect(ex.merchant_settlement!(stepCtx)).rejects.toThrow(
        'paystack_settlement_collection_unknown'
      );
      expect(args.supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe('firs_invoice / loyalty_points stubs', () => {
    // The stub is `() => { throw }` — synchronous, not returning a
    // rejected Promise. applyPaidOrderSideEffects's try/catch wraps
    // the call so production sees a normal failure path. Test the
    // sync-throw shape directly.
    it("both throw 'wired_in_b3_5' so consistent orders get a replayable failed row", () => {
      const ex = buildScriptExecutors(defaultArgs());
      expect(() => ex.firs_invoice!(stepCtx)).toThrow('wired_in_b3_5');
      expect(() => ex.loyalty_points!(stepCtx)).toThrow('wired_in_b3_5');
    });
  });
});
