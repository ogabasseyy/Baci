import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedvaultCheckoutSummary } from './get-redvault-checkout-summary';
import {
  verifyRedvaultLivePilotFunding,
  verifyRedvaultLivePilotSnapshot,
} from './redvault-live-pilot-verification';

vi.mock('./get-redvault-checkout-summary', () => ({
  getRedvaultCheckoutSummary: vi.fn(),
}));
vi.mock('./redvault-live-pilot', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./redvault-live-pilot')>();
  return {
    ...original,
    getRedvaultLivePilotPolicy: vi.fn(),
  };
});

const { getRedvaultCheckoutSummary } = await import(
  './get-redvault-checkout-summary'
);
const { getRedvaultLivePilotPolicy } = await import('./redvault-live-pilot');

const PILOT_USER_ID = '70261bce-d358-45a4-9ede-8b9d71fb3bd9';
const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function summaryFixture(
  order: Partial<RedvaultCheckoutSummary['order']> = {},
  quote: Partial<RedvaultCheckoutSummary['quote']> = {}
): RedvaultCheckoutSummary {
  return {
    order: {
      currency: 'NGN',
      id: 'order-1',
      payment_method: 'uba_redvault',
      payment_status: 'unpaid',
      total: 95,
      tracking_token: null,
      ...order,
    },
    quote: {
      discount_kobo: 500,
      assurance_fee_kobo: 0,
      eligible_subtotal_kobo: 10_000,
      gift_wrapping_kobo: 0,
      ineligible_subtotal_kobo: 0,
      mixed_basket: false,
      payable_kobo: 9500,
      product_subtotal_kobo: 10_000,
      shipping_kobo: 0,
      tax_kobo: 0,
      ...quote,
    },
  };
}

function policyFixture() {
  return {
    enabled: true,
    merchantId: MERCHANT_ID,
    productId: '11111111-1111-4111-8111-111111111111',
    expiresAt: Date.now() + 3600_000,
    maxAttempts: 1,
  };
}

function snapshotInput(
  overrides: { userId?: string | null; merchantId?: string } = {}
) {
  return {
    client: {} as SupabaseClient,
    orderId: 'order-1',
    userId: overrides.userId === undefined ? PILOT_USER_ID : overrides.userId,
    merchantId:
      overrides.merchantId === undefined ? MERCHANT_ID : overrides.merchantId,
  };
}

const UNAVAILABLE_REJECTION = {
  ok: false,
  rejection: {
    message: 'REDVAULT payment is not available',
    code: 'REDVAULT_UNAVAILABLE',
    status: 409,
  },
} as const;

describe('verifyRedvaultLivePilotSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedvaultLivePilotPolicy).mockReturnValue(policyFixture());
    vi.mocked(getRedvaultCheckoutSummary).mockResolvedValue(summaryFixture());
  });

  it('accepts the exact controlled-test snapshot', async () => {
    const input = snapshotInput();
    const result = await verifyRedvaultLivePilotSnapshot(input);

    expect(result).toEqual({ ok: true });
    expect(getRedvaultCheckoutSummary).toHaveBeenCalledWith({
      client: input.client,
      orderId: 'order-1',
    });
  });

  it('accepts a taxed snapshot whose total derives from the recomputed tax', async () => {
    vi.mocked(getRedvaultCheckoutSummary).mockResolvedValue(
      summaryFixture({ total: 102.5 }, { tax_kobo: 750, payable_kobo: 10250 })
    );
    const result = await verifyRedvaultLivePilotSnapshot(snapshotInput());

    expect(result).toEqual({ ok: true });
  });

  it('rejects a missing pilot policy', async () => {
    vi.mocked(getRedvaultLivePilotPolicy).mockReturnValue(null);
    const result = await verifyRedvaultLivePilotSnapshot(snapshotInput());

    expect(result).toEqual(UNAVAILABLE_REJECTION);
  });

  it.each([
    ['other-user'],
    [null],
  ])('rejects a non-pilot user %j', async (userId) => {
    const result = await verifyRedvaultLivePilotSnapshot(
      snapshotInput({ userId })
    );

    expect(result).toEqual(UNAVAILABLE_REJECTION);
  });

  it('rejects a non-pilot merchant', async () => {
    const result = await verifyRedvaultLivePilotSnapshot(
      snapshotInput({ merchantId: 'other-merchant' })
    );

    expect(result).toEqual(UNAVAILABLE_REJECTION);
  });

  it.each([
    ['non-NGN currency', { currency: 'USD' }, {}],
    ['negative total', { total: -1 }, {}],
    ['drifted total', { total: 102.25 }, {}],
    ['drifted payable', {}, { payable_kobo: 10225 }],
    // Nonzero tax is allowed only when payable/total derive from it: tax
    // 725 against payable 9500 is arithmetic drift, not a derived total.
    ['tax inconsistent with payable', {}, { tax_kobo: 725 }],
    [
      'taxed snapshot with stale total',
      { total: 95 },
      { tax_kobo: 750, payable_kobo: 10250 },
    ],
    [
      'taxed snapshot with stale payable',
      { total: 102.5 },
      { tax_kobo: 750, payable_kobo: 9500 },
    ],
    ['wrong subtotal', {}, { product_subtotal_kobo: 9999 }],
    ['wrong eligible', {}, { eligible_subtotal_kobo: 9999 }],
    ['ineligible present', {}, { ineligible_subtotal_kobo: 1 }],
    ['wrong discount', {}, { discount_kobo: 499 }],
    ['assurance fee', {}, { assurance_fee_kobo: 1 }],
    ['shipping fee', {}, { shipping_kobo: 1 }],
    ['wrapping fee', {}, { gift_wrapping_kobo: 1 }],
    ['mixed basket', {}, { mixed_basket: true }],
  ])('rejects %s', async (_label, order, quote) => {
    vi.mocked(getRedvaultCheckoutSummary).mockResolvedValue(
      summaryFixture(order, quote)
    );
    const result = await verifyRedvaultLivePilotSnapshot(snapshotInput());

    expect(result).toEqual(UNAVAILABLE_REJECTION);
  });

  it('maps a summary lookup failure to ORDER_AMOUNT_LOOKUP_FAILED', async () => {
    vi.mocked(getRedvaultCheckoutSummary).mockRejectedValue(
      new Error('rpc down')
    );
    const result = await verifyRedvaultLivePilotSnapshot(snapshotInput());

    expect(result).toEqual({
      ok: false,
      rejection: {
        message: 'Unable to verify REDVAULT order',
        code: 'ORDER_AMOUNT_LOOKUP_FAILED',
        status: 500,
      },
    });
  });
});

describe('verifyRedvaultLivePilotFunding', () => {
  it('accepts zero wallet and savings funding', () => {
    expect(
      verifyRedvaultLivePilotFunding({
        walletAmountUsed: 0,
        savingsAmountUsed: 0,
      })
    ).toEqual({ ok: true });
  });

  it.each([
    [{ walletAmountUsed: 1, savingsAmountUsed: 0 }],
    [{ walletAmountUsed: 0, savingsAmountUsed: 1 }],
  ])('rejects persisted funding %j', (funding) => {
    expect(verifyRedvaultLivePilotFunding(funding)).toEqual(
      UNAVAILABLE_REJECTION
    );
  });
});
