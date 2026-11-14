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
import {
  defaultArgs,
  merchantDetails,
  richOrder,
} from './reconcile-paystack-dva-executors.test-support';

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
