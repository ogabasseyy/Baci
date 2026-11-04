import { describe, expect, it, vi } from 'vitest';
import { chargeDueCustomerSavingsGoals } from './customer-savings-auto-debit';
import {
  baseDueGoal,
  createAutoDebitSupabase,
} from './customer-savings-auto-debit.test-utils';
import type { SavingsAutoDebitDatabaseClient } from './customer-savings-auto-debit-types';

describe('chargeDueCustomerSavingsGoals', () => {
  it('fails a goal without charging when the saved payment method is unavailable', async () => {
    const { supabase, transactionInsert } = createAutoDebitSupabase();

    const result = await chargeDueCustomerSavingsGoals({
      chargeAuthorizationFn: vi.fn(),
      creditWalletTopUpFn: vi.fn(),
      loadSavedPaymentMethodFn: vi.fn().mockResolvedValue(null),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(result.failed).toBe(1);
    expect(result.results[0]).toMatchObject({
      reason: 'saved_payment_method_unavailable',
      status: 'failed',
    });
    expect(transactionInsert).not.toHaveBeenCalled();
  });

  it('skips an existing idempotent contribution for the due period', async () => {
    const { supabase } = createAutoDebitSupabase({
      existingContribution: { id: 'existing-1', status: 'completed' },
    });
    const chargeAuthorizationFn = vi.fn();

    const result = await chargeDueCustomerSavingsGoals({
      chargeAuthorizationFn,
      creditWalletTopUpFn: vi.fn(),
      loadSavedPaymentMethodFn: vi.fn(),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(result.skipped).toBe(1);
    expect(result.results[0]).toMatchObject({
      reason: 'existing_completed',
      status: 'skipped',
    });
    expect(chargeAuthorizationFn).not.toHaveBeenCalled();
  });

  it('skips active goals before the scheduled Lagos debit time', async () => {
    const { supabase } = createAutoDebitSupabase();

    const result = await chargeDueCustomerSavingsGoals({
      chargeAuthorizationFn: vi.fn(),
      creditWalletTopUpFn: vi.fn(),
      loadSavedPaymentMethodFn: vi.fn(),
      now: new Date('2026-05-21T04:59:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(result.skipped).toBe(1);
    expect(result.results[0]).toMatchObject({
      reason: 'not_due',
      status: 'skipped',
    });
  });

  it('marks a processing contribution failed when Paystack declines the charge', async () => {
    const { contributionUpdateEq, supabase } = createAutoDebitSupabase();

    const result = await chargeDueCustomerSavingsGoals({
      chargeAuthorizationFn: vi.fn().mockResolvedValue({
        data: {
          amount: 2_000_000,
          currency: 'NGN',
          gateway_response: 'Declined',
          message: null,
          reference: 'SVG-111111111111-2026-05-21',
          status: 'failed',
        },
        success: true,
      }),
      creditWalletTopUpFn: vi.fn(),
      loadSavedPaymentMethodFn: vi.fn().mockResolvedValue({
        authorization_code: 'AUTH_saved',
        provider_customer_email: 'jane@example.com',
      }),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(result.failed).toBe(1);
    expect(result.results[0]?.status).toBe('failed');
    expect(contributionUpdateEq).toHaveBeenCalledWith('id', 'contribution-1');
  });

  it('marks transaction and contribution failed when Paystack authorization throws', async () => {
    const { contributionUpdateEq, supabase, transactionUpdateEq } =
      createAutoDebitSupabase();

    const result = await chargeDueCustomerSavingsGoals({
      chargeAuthorizationFn: vi
        .fn()
        .mockRejectedValue(new Error('Paystack timeout')),
      creditWalletTopUpFn: vi.fn(),
      loadSavedPaymentMethodFn: vi.fn().mockResolvedValue({
        authorization_code: 'AUTH_saved',
        provider_customer_email: 'jane@example.com',
      }),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(result.failed).toBe(1);
    expect(transactionUpdateEq).toHaveBeenCalledWith('id', 'txn-1');
    expect(contributionUpdateEq).toHaveBeenCalledWith('id', 'contribution-1');
  });

  it('rejects invalid savings amounts before charging Paystack', async () => {
    const { supabase } = createAutoDebitSupabase({
      goals: [{ ...baseDueGoal, contribution_amount: 'invalid' }],
    });
    const chargeAuthorizationFn = vi.fn();

    const result = await chargeDueCustomerSavingsGoals({
      chargeAuthorizationFn,
      creditWalletTopUpFn: vi.fn(),
      loadSavedPaymentMethodFn: vi.fn(),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });
    // One goal's failure is isolated and reported, never thrown.
    expect(result).toMatchObject({ failed: 1, processed: 0, errored: 1 });
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('Invalid savings amount'),
    });
    expect(chargeAuthorizationFn).not.toHaveBeenCalled();
  });

  it('returns allocation errors after the wallet pass-through succeeds', async () => {
    const { contributionUpdateEq, reconciliationInsert, supabase } =
      createAutoDebitSupabase({
        allocationError: { message: 'Savings allocation failed' },
      });

    const result = await chargeDueCustomerSavingsGoals({
      chargeAuthorizationFn: vi.fn().mockResolvedValue({
        data: {
          amount: 2_000_000,
          currency: 'NGN',
          gateway_response: 'Approved',
          message: null,
          reference: 'SVG-111111111111-2026-05-21',
          status: 'success',
        },
        success: true,
      }),
      creditWalletTopUpFn: vi.fn().mockResolvedValue({
        balance: 20000,
        reference: 'SVG-111111111111-2026-05-21',
        transactionId: 'wallet-credit-1',
      }),
      loadSavedPaymentMethodFn: vi.fn().mockResolvedValue({
        authorization_code: 'AUTH_saved',
        provider_customer_email: 'jane@example.com',
      }),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });
    // One goal's failure is isolated and reported, never thrown.
    expect(result).toMatchObject({ failed: 1, processed: 0 });
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('Savings allocation failed'),
    });
    expect(reconciliationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'customer_savings_auto_debit_allocation_failed',
        metadata: expect.objectContaining({ wallet_credit_applied: true }),
        paystack_ref: 'SVG-111111111111-2026-05-21',
        reason: 'Savings allocation failed',
        txn_id: 'txn-1',
      })
    );
    expect(contributionUpdateEq).toHaveBeenCalledWith('id', 'contribution-1');
  });

  it('records reconciliation and fails the contribution when wallet credit fails after a successful charge', async () => {
    const { contributionUpdateEq, reconciliationInsert, supabase } =
      createAutoDebitSupabase();

    const result = await chargeDueCustomerSavingsGoals({
      chargeAuthorizationFn: vi.fn().mockResolvedValue({
        data: {
          amount: 2_000_000,
          currency: 'NGN',
          gateway_response: 'Approved',
          message: null,
          reference: 'SVG-111111111111-2026-05-21',
          status: 'success',
        },
        success: true,
      }),
      creditWalletTopUpFn: vi
        .fn()
        .mockRejectedValue(new Error('Wallet credit failed')),
      loadSavedPaymentMethodFn: vi.fn().mockResolvedValue({
        authorization_code: 'AUTH_saved',
        provider_customer_email: 'jane@example.com',
      }),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });
    // One goal's failure is isolated and reported, never thrown.
    expect(result).toMatchObject({ failed: 1, processed: 0 });
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('Wallet credit failed'),
    });
    expect(reconciliationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'customer_savings_auto_debit_allocation_failed',
        metadata: expect.objectContaining({ wallet_credit_applied: false }),
        paystack_ref: 'SVG-111111111111-2026-05-21',
        reason: 'Wallet credit failed',
        txn_id: 'txn-1',
      })
    );
    expect(contributionUpdateEq).toHaveBeenCalledWith('id', 'contribution-1');
  });
});
