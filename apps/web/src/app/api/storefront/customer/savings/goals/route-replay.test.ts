import { describe, expect, it, vi } from 'vitest';
import { buildGoalRequestFingerprint } from './route-helpers';
import { tryReplaySavingsGoalCreation } from './route-replay';

const goalInput = {
  goalIdempotencyKey: 'key-1',
  breakFeePercent: 0,
  contributionAmount: 100,
  contributionFrequency: 'weekly',
  earlyEndFeeAccepted: false,
  initialContributionAmount: 0,
  maturityDate: '2027-01-01',
  metadata: {},
  preferredDebitTime: null,
  productId: 'product-1',
  savedPaymentMethodId: null,
  sourceMode: 'manual',
  startDate: '2026-10-01',
  targetAmount: 1000,
  title: 'Phone',
  variantId: null,
};

function fingerprint() {
  return buildGoalRequestFingerprint(goalInput);
}

function supabaseWith(goalRow: unknown, walletRow: unknown = null) {
  const goalQuery = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: goalRow, error: null }),
  };
  const walletQuery = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: walletRow, error: null }),
  };
  return {
    from: vi.fn((table: string) => ({
      select: vi
        .fn()
        .mockReturnValue(
          table === 'customer_wallets' ? walletQuery : goalQuery
        ),
    })),
  };
}

describe('tryReplaySavingsGoalCreation', () => {
  it('continues without a fingerprint when no idempotency key is present', async () => {
    const supabase = supabaseWith(null);
    const result = await tryReplaySavingsGoalCreation({
      customerId: 'customer',
      goalInput: { ...goalInput, goalIdempotencyKey: null } as never,
      merchantId: 'merchant',
      supabase: supabase as never,
    });
    expect(result).toEqual({ kind: 'continue', requestFingerprint: null });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('continues when no retained goal matches', async () => {
    const supabase = supabaseWith(null);
    const result = await tryReplaySavingsGoalCreation({
      customerId: 'customer',
      goalInput: goalInput as never,
      merchantId: 'merchant',
      supabase: supabase as never,
    });
    expect(result.kind).toBe('continue');
  });

  it('replays a fingerprint-matching retained goal', async () => {
    const supabase = supabaseWith(
      {
        id: 'goal-1',
        status: 'active',
        current_amount: 50,
        contribution_amount: 100,
        contribution_frequency: 'weekly',
        goal_request_fingerprint: fingerprint(),
      },
      { available_balance: 500 }
    );
    const result = await tryReplaySavingsGoalCreation({
      customerId: 'customer',
      goalInput: goalInput as never,
      merchantId: 'merchant',
      supabase: supabase as never,
    });
    expect(result.kind).toBe('replayed');
    if (result.kind === 'replayed') {
      const body = (await result.response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        goalId: 'goal-1',
        goalStatus: 'active',
        success: true,
        walletBalance: 500,
      });
    }
  });
});
