import { describe, expect, it, vi } from 'vitest';
import { chargeDueCustomerSavingsGoals } from './customer-savings-auto-debit';
import {
  baseDueGoal,
  createAutoDebitSupabase,
  createChain,
} from './customer-savings-auto-debit.test-utils';
import type {
  DueSavingsGoalRow,
  SavingsAutoDebitDatabaseClient,
} from './customer-savings-auto-debit-types';
import { logger } from './logger';

describe('chargeDueCustomerSavingsGoals selection', () => {
  it('returns zero processed when no auto-debit goals are due', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customer_savings_goals') {
          return createChain({ data: [], error: null });
        }
        return createChain({ data: null, error: null });
      }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    const result = await chargeDueCustomerSavingsGoals({
      chargeAuthorizationFn: vi.fn(),
      creditWalletTopUpFn: vi.fn(),
      loadSavedPaymentMethodFn: vi.fn(),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(result).toEqual({
      errored: 0,
      failed: 0,
      processed: 0,
      results: [],
      skipped: 0,
    });
  });

  it('keeps processing due goals when earlier fetched goals are not due', async () => {
    const notDueGoal: DueSavingsGoalRow = {
      ...baseDueGoal,
      id: '99999999-9999-4999-8999-999999999999',
      preferred_debit_time: '23:20:00',
    };
    const dueGoal: DueSavingsGoalRow = {
      ...baseDueGoal,
      id: '22222222-2222-4222-8222-222222222222',
    };
    const { supabase, transactionInsert } = createAutoDebitSupabase({
      goals: [notDueGoal, dueGoal],
    });
    const chargeAuthorizationFn = vi.fn().mockResolvedValue({
      data: {
        amount: 2_000_000,
        currency: 'NGN',
        gateway_response: 'Approved',
        message: null,
        reference: 'SVG-222222222222-2026-05-21',
        status: 'success',
      },
      success: true,
    });

    const result = await chargeDueCustomerSavingsGoals({
      batchSize: 1,
      chargeAuthorizationFn,
      creditWalletTopUpFn: vi.fn().mockResolvedValue({
        balance: 20000,
        reference: 'SVG-222222222222-2026-05-21',
        transactionId: 'wallet-credit-1',
      }),
      loadSavedPaymentMethodFn: vi.fn().mockResolvedValue({
        authorization_code: 'AUTH_saved',
        provider_customer_email: 'jane@example.com',
      }),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: notDueGoal.id,
          reason: 'not_due',
          status: 'skipped',
        }),
        expect.objectContaining({
          goalId: dueGoal.id,
          status: 'charged',
        }),
      ])
    );
    expect(transactionInsert).toHaveBeenCalledTimes(1);
    expect(chargeAuthorizationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: 'SVG-222222222222-2026-05-21',
      })
    );
  });

  it('pages beyond a full non-due result set to find a due goal', async () => {
    const notDueGoals = Array.from({ length: 4 }, (_, index) => ({
      ...baseDueGoal,
      id: `99999999-9999-4999-8999-99999999999${index}`,
      preferred_debit_time: '23:20:00',
    }));
    const dueGoal = {
      ...baseDueGoal,
      id: '22222222-2222-4222-8222-222222222222',
    };
    const { supabase } = createAutoDebitSupabase({
      goalPages: [notDueGoals, [dueGoal]],
    });
    const chargeAuthorizationFn = vi.fn().mockResolvedValue({
      data: {
        amount: 2_000_000,
        currency: 'NGN',
        gateway_response: 'Approved',
        message: null,
        reference: 'SVG-222222222222-2026-05-21',
        status: 'success',
      },
      success: true,
    });

    const result = await chargeDueCustomerSavingsGoals({
      batchSize: 1,
      chargeAuthorizationFn,
      creditWalletTopUpFn: vi.fn().mockResolvedValue({
        balance: 20000,
        reference: 'SVG-222222222222-2026-05-21',
        transactionId: 'wallet-credit-1',
      }),
      loadSavedPaymentMethodFn: vi.fn().mockResolvedValue({
        authorization_code: 'AUTH_saved',
        provider_customer_email: 'jane@example.com',
      }),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(4);
    expect(chargeAuthorizationFn).toHaveBeenCalledTimes(1);
  });
});

describe('chargeDueCustomerSavingsGoals primary-wallet goals and isolation', () => {
  const primaryGoal: DueSavingsGoalRow = {
    ...baseDueGoal,
    id: '33333333-3333-4333-8333-333333333333',
  };
  const legacyGoal: DueSavingsGoalRow = {
    ...baseDueGoal,
    id: '22222222-2222-4222-8222-222222222222',
  };
  const approved = {
    data: {
      amount: 2_000_000,
      currency: 'NGN',
      gateway_response: 'Approved',
      message: null,
      reference: 'SVG-222222222222-2026-05-21',
      status: 'success',
    },
    success: true,
  };
  const savedMethod = {
    authorization_code: 'AUTH_saved',
    provider_customer_email: 'jane@example.com',
  };
  const now = new Date('2026-05-21T07:30:00.000Z');

  it('never selects a goal bound to a PiggyVest wallet: no charge, no rows, other goals still run', async () => {
    const { supabase, transactionInsert, contributionInsert } =
      createAutoDebitSupabase({
        goals: [primaryGoal, legacyGoal],
        primaryBoundGoalIds: [primaryGoal.id],
      });
    const chargeAuthorizationFn = vi.fn().mockResolvedValue(approved);

    const result = await chargeDueCustomerSavingsGoals({
      batchSize: 1,
      chargeAuthorizationFn,
      creditWalletTopUpFn: vi.fn().mockResolvedValue({
        balance: 20000,
        reference: 'SVG-222222222222-2026-05-21',
        transactionId: 'wallet-credit-1',
      }),
      loadSavedPaymentMethodFn: vi.fn().mockResolvedValue(savedMethod),
      now,
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'savings_goal_ids_bound_to_primary',
      { p_goal_ids: [primaryGoal.id, legacyGoal.id] }
    );
    expect(chargeAuthorizationFn).toHaveBeenCalledTimes(1);
    expect(transactionInsert).toHaveBeenCalledTimes(1);
    expect(contributionInsert).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
    expect(result.results).toContainEqual(
      expect.objectContaining({
        goalId: primaryGoal.id,
        reason: 'primary_wallet_goal',
        status: 'skipped',
      })
    );
  });

  it('charges nothing when the goals can not be classified', async () => {
    const { supabase } = createAutoDebitSupabase({ goals: [legacyGoal] });
    supabase.rpc.mockResolvedValueOnce({
      data: [],
      error: { message: 'rpc unavailable' },
    });
    const chargeAuthorizationFn = vi.fn();

    await expect(
      chargeDueCustomerSavingsGoals({
        chargeAuthorizationFn,
        creditWalletTopUpFn: vi.fn(),
        loadSavedPaymentMethodFn: vi.fn(),
        now,
        supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
      })
    ).rejects.toThrow('rpc unavailable');
    expect(chargeAuthorizationFn).not.toHaveBeenCalled();
  });

  it("isolates one goal's failure: it is logged and reported, the other goal is still charged", async () => {
    const { supabase } = createAutoDebitSupabase({
      goals: [{ ...baseDueGoal, contribution_amount: 'invalid' }, legacyGoal],
    });
    const chargeAuthorizationFn = vi.fn().mockResolvedValue(approved);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const result = await chargeDueCustomerSavingsGoals({
      batchSize: 2,
      chargeAuthorizationFn,
      creditWalletTopUpFn: vi.fn().mockResolvedValue({
        balance: 20000,
        reference: 'SVG-222222222222-2026-05-21',
        transactionId: 'wallet-credit-1',
      }),
      loadSavedPaymentMethodFn: vi.fn().mockResolvedValue(savedMethod),
      now,
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(result).toMatchObject({ failed: 1, processed: 1 });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: baseDueGoal.id })
    );
    error.mockRestore();
  });
});
