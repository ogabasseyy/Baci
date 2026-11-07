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

import { buildScriptExecutors } from '@/scripts/reconcile-paystack-dva-executors';
import { defaultArgs, richOrder } from './reconcile-paystack-dva-executors.test-support';

describe('buildScriptExecutors merchant_settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1' });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const stepCtx = {
    order: defaultArgs().order,
    transaction: defaultArgs().transaction,
    gatewayResponse: {},
    consistency: { consistent: true, detail: null } as never,
  };

  describe('merchant_settlement', () => {
    // A Baci-owned DVA: Paystack shows no subaccount, so the credit stays a
    // wallet credit marked as Baci-collected.
    const baciCollectedCtx = { ...stepCtx, gatewayResponse: { fees_split: null, subaccount: {} } };

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
          amount: 112_500,
          fees_split: { integration: 0, paystack: 1_500, subaccount: 111_000 },
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
          amount: 112_500,
          fees_split: { integration: 0, paystack: 1_500, subaccount: 111_000 },
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
        await ex.merchant_settlement!({ ...stepCtx, gatewayResponse: { fees_split: null, subaccount: {} } });
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
        await ex.merchant_settlement!({ ...stepCtx, gatewayResponse: { fees_split: null, subaccount: {} } });
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
});
