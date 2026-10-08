import { describe, expect, it } from 'vitest';
import {
  buildGoalRequestFingerprint,
  formatSavingsGoal,
  mapSavingsRpcErrorStatus,
  resolveCreateGoalRpcRow,
  type SavingsGoalRow,
  toSavingsRouteNumber,
  toSavingsRpcError,
} from './route-helpers';

const savingsGoalRow: SavingsGoalRow = {
  break_fee_percent: '5',
  cancelled_at: null,
  completed_at: null,
  contribution_amount: '20000',
  contribution_frequency: 'daily',
  created_at: '2026-05-21T10:00:00.000Z',
  current_amount: '150000',
  future_debits_cancelled_at: null,
  id: 'goal-1',
  initial_contribution_amount: '20000',
  maturity_date: '2026-06-30',
  metadata: null,
  preferred_debit_time: '06:20:00',
  product_id: 'product-1',
  product_snapshot: null,
  saved_payment_method_id: null,
  source_mode: 'manual',
  spent_at: null,
  start_date: '2026-05-21',
  status: 'active',
  target_amount: '800000',
  title: 'Device savings',
  updated_at: '2026-05-21T10:01:00.000Z',
  variant_id: null,
};

describe('savings goals route helpers', () => {
  it('normalizes numeric database values and falls back to zero', () => {
    expect(toSavingsRouteNumber('150000')).toBe(150000);
    expect(toSavingsRouteNumber('not-a-number')).toBe(0);
  });

  it('formats savings goal rows for API responses', () => {
    expect(formatSavingsGoal(savingsGoalRow)).toMatchObject({
      breakFeePercent: 5,
      contributionAmount: 20000,
      currentAmount: 150000,
      metadata: {},
      productSnapshot: {},
      targetAmount: 800000,
    });
  });

  it('maps expected RPC failures to client-safe statuses', () => {
    expect(mapSavingsRpcErrorStatus('invalid product id', '22023')).toBe(400);
    expect(mapSavingsRpcErrorStatus('not_authorized', '42501')).toBe(403);
    expect(mapSavingsRpcErrorStatus('goal_not_found')).toBe(404);
    expect(mapSavingsRpcErrorStatus('variant_not_available_for_savings')).toBe(
      404
    );
    expect(mapSavingsRpcErrorStatus('insufficient_wallet_balance')).toBe(409);
    expect(
      mapSavingsRpcErrorStatus(
        'savings_goal_not_swappable_pending_transfer',
        'P0001'
      )
    ).toBe(409);
    expect(mapSavingsRpcErrorStatus('database unavailable')).toBe(500);
  });

  it('returns a conflict when an owned saved payment method is unavailable', () => {
    expect(
      mapSavingsRpcErrorStatus('saved_payment_method_not_available_for_savings')
    ).toBe(409);
  });

  it('returns a conflict for a reused key with a changed payload', () => {
    expect(
      mapSavingsRpcErrorStatus('mismatched_goal_idempotency_payload', 'P0001')
    ).toBe(409);
  });

  it('fingerprints the raw requested plan deterministically', () => {
    const input = {
      breakFeePercent: 5,
      contributionAmount: 20000,
      contributionFrequency: 'weekly',
      earlyEndFeeAccepted: true,
      initialContributionAmount: 0,
      maturityDate: '2026-12-31',
      metadata: { channel: 'storefront', campaign: 'launch' },
      preferredDebitTime: null,
      productId: 'product-1',
      savedPaymentMethodId: 'payment-method-1',
      sourceMode: 'manual',
      startDate: '2026-10-04',
      targetAmount: 800000,
      title: 'Device savings goal',
      variantId: null,
    };
    const first = buildGoalRequestFingerprint(input);
    const second = buildGoalRequestFingerprint({ ...input });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(
      buildGoalRequestFingerprint({ ...input, targetAmount: 900000 })
    ).not.toBe(first);
    expect(
      buildGoalRequestFingerprint({ ...input, variantId: 'variant-2' })
    ).not.toBe(first);
    expect(
      buildGoalRequestFingerprint({
        ...input,
        savedPaymentMethodId: 'payment-method-2',
      })
    ).not.toBe(first);
    expect(
      buildGoalRequestFingerprint({ ...input, breakFeePercent: 10 })
    ).not.toBe(first);
    expect(
      buildGoalRequestFingerprint({ ...input, title: 'Renamed goal' })
    ).not.toBe(first);
    expect(
      buildGoalRequestFingerprint({
        ...input,
        metadata: { channel: 'storefront', campaign: 'relaunch' },
      })
    ).not.toBe(first);
    expect(
      buildGoalRequestFingerprint({ ...input, earlyEndFeeAccepted: false })
    ).not.toBe(first);
    expect(
      buildGoalRequestFingerprint({
        ...input,
        metadata: { campaign: 'launch', channel: 'storefront' },
      })
    ).toBe(first);
    expect(
      buildGoalRequestFingerprint({
        ...input,
        variantId: undefined,
        initialContributionAmount: undefined,
      })
    ).toBe(first);
    expect(
      buildGoalRequestFingerprint({
        ...input,
        breakFeePercent: null,
        savedPaymentMethodId: null,
      })
    ).not.toBe(first);
  });

  it('does not classify unknown unavailable failures as missing resources', () => {
    expect(mapSavingsRpcErrorStatus('provider_not_available')).toBe(500);
  });

  it('extracts RPC error shape', () => {
    expect(toSavingsRpcError({ code: 'P0001', message: 'failed' })).toEqual({
      code: 'P0001',
      message: 'failed',
    });
    expect(toSavingsRpcError(null)).toBeNull();
  });

  it('resolves the first create-goal RPC row', () => {
    expect(
      resolveCreateGoalRpcRow([
        {
          contribution_id: 'contribution-1',
          current_amount: '20000',
          goal_id: 'goal-1',
          goal_status: 'active',
          success: true,
          wallet_balance: '180000',
        },
      ])
    ).toMatchObject({ goal_id: 'goal-1', success: true });
    expect(resolveCreateGoalRpcRow([])).toBeNull();
    expect(resolveCreateGoalRpcRow([{ goal_id: 'goal-1' }])).toBeNull();
  });
});
