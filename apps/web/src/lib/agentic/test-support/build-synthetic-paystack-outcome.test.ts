// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { confirmAgenticPaystackDvaPayment } from '@/lib/agentic/paystack-dva-webhook';
import {
  buildSyntheticDvaSession,
  SYNTHETIC_DVA_ACCOUNT_NUMBER,
} from './build-synthetic-dva-session';
import {
  buildSyntheticPaystackOutcome,
  type SyntheticPaystackOutcomeKind,
} from './build-synthetic-paystack-outcome';
import { SYNTHETIC_MERCHANT_A } from './synthetic-merchants';

const KINDS: SyntheticPaystackOutcomeKind[] = [
  'paid_exact',
  'paid_short',
  'timeout',
  'duplicate_webhook',
];

// No order yet, so a payment that clears the amount checks stops at the
// missing order instead of writing a transaction.
const SESSION = buildSyntheticDvaSession(SYNTHETIC_MERCHANT_A, {
  orderId: null,
  totalAmount: 79.96,
});

function fakeSupabase() {
  const sessions = {
    in: vi.fn().mockResolvedValue({ data: [SESSION], error: null }),
    or: vi.fn(),
  };
  sessions.or.mockReturnValue(sessions);
  const transactions = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  transactions.eq.mockReturnValue(transactions);
  return {
    from: vi.fn((table: string) => {
      if (table === 'checkout_sessions') {
        return { select: vi.fn(() => sessions) };
      }
      if (table === 'transactions') {
        return { select: vi.fn(() => transactions) };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

function confirm(kind: SyntheticPaystackOutcomeKind) {
  const outcome = buildSyntheticPaystackOutcome(kind, SESSION);
  return confirmAgenticPaystackDvaPayment({
    accountNumber: SYNTHETIC_DVA_ACCOUNT_NUMBER,
    gatewayReference: outcome.gatewayReference,
    supabase: fakeSupabase() as never,
    verifiedAmount: outcome.verifiedAmount,
  });
}

describe('synthetic Paystack outcomes', () => {
  it.each(KINDS)('builds the %s outcome', (kind) => {
    const outcome = buildSyntheticPaystackOutcome(kind, SESSION);

    expect(outcome.kind).toBe(kind);
    expect(outcome.webhooks).toHaveLength(kind === 'duplicate_webhook' ? 2 : 1);
    expect(outcome.indeterminate).toBe(kind === 'timeout');
  });

  it('pays the exact total, one kobo short, or leaves it unverified', () => {
    const amount = (kind: SyntheticPaystackOutcomeKind) =>
      buildSyntheticPaystackOutcome(kind, SESSION).verifiedAmount;

    expect(amount('paid_exact')).toEqual({ amount: 79.96, currency: 'NGN' });
    expect(amount('duplicate_webhook')).toEqual({
      amount: 79.96,
      currency: 'NGN',
    });
    expect(amount('paid_short')).toEqual({ amount: 79.95, currency: 'NGN' });
    expect(amount('timeout')).toBeNull();
  });

  it('is identical on every build', () => {
    expect(buildSyntheticPaystackOutcome('paid_exact', SESSION)).toEqual(
      buildSyntheticPaystackOutcome('paid_exact', SESSION)
    );
  });

  it('drives the real DVA confirmation to the matching result', async () => {
    await expect(confirm('paid_short')).resolves.toMatchObject({
      body: { error: 'Payment amount mismatch' },
      status: 400,
    });
    await expect(confirm('timeout')).resolves.toMatchObject({
      body: { error: 'Payment amount verification unavailable' },
      status: 400,
    });
    await expect(confirm('paid_exact')).resolves.toMatchObject({
      body: { error: 'Agentic checkout order not found' },
      status: 409,
    });
  });
});
