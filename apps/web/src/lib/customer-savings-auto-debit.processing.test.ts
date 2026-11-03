import { describe, expect, it, vi } from 'vitest';
import { chargeDueCustomerSavingsGoals } from './customer-savings-auto-debit';
import { createChain } from './customer-savings-auto-debit.test-utils';
import type { SavingsAutoDebitDatabaseClient } from './customer-savings-auto-debit-types';

describe('chargeDueCustomerSavingsGoals processing', () => {
  it('charges a due goal and allocates the wallet pass-through once', async () => {
    const transactionInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'txn-1' },
      error: null,
    });
    const contributionInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'contribution-1' },
      error: null,
    });
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateChain = { eq: updateEq };
    const transactionInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: transactionInsertSingle }),
    });
    const contributionInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: contributionInsertSingle }),
    });
    const transactionUpdate = vi.fn().mockReturnValue(updateChain);
    const contributionUpdate = vi.fn().mockReturnValue(updateChain);

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customer_savings_goals') {
          return createChain({
            data: [
              {
                contribution_amount: '20000',
                contribution_frequency: 'daily',
                current_amount: '100000',
                customer_id: 'customer-1',
                id: '11111111-1111-4111-8111-111111111111',
                maturity_date: '2026-06-30',
                merchant_id: 'merchant-1',
                preferred_debit_time: '06:20:00',
                saved_payment_method_id: 'payment-method-1',
                start_date: '2026-05-20',
                target_amount: '800000',
              },
            ],
            error: null,
          });
        }

        if (table === 'customer_savings_contributions') {
          return {
            insert: contributionInsert,
            select: vi.fn().mockReturnThis(),
            update: contributionUpdate,
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }

        if (table === 'transactions') {
          return {
            insert: transactionInsert,
            select: vi.fn().mockReturnThis(),
            update: transactionUpdate,
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }

        return createChain({ data: null, error: null });
      }),
      rpc: vi.fn(async (name: string) =>
        name === 'savings_goal_ids_bound_to_primary'
          ? { data: [], error: null }
          : {
              data: [
                {
                  contribution_id: 'contribution-1',
                  goal_current_amount: '120000',
                  goal_status: 'active',
                  success: true,
                  wallet_balance: '0',
                  wallet_transaction_id: 'wallet-debit-1',
                },
              ],
              error: null,
            }
      ),
    };
    const chargeAuthorizationFn = vi.fn().mockResolvedValue({
      data: {
        amount: 2_000_000,
        currency: 'NGN',
        gateway_response: 'Approved',
        message: null,
        reference: 'SVG-111111111111-2026-05-21',
        status: 'success',
      },
      success: true,
    });
    const creditWalletTopUpFn = vi.fn().mockResolvedValue({
      balance: 20000,
      reference: 'SVG-111111111111-2026-05-21',
      transactionId: 'wallet-credit-1',
    });

    const result = await chargeDueCustomerSavingsGoals({
      chargeAuthorizationFn,
      creditWalletTopUpFn,
      loadSavedPaymentMethodFn: vi.fn().mockResolvedValue({
        authorization_code: 'AUTH_saved',
        provider_customer_email: 'jane@example.com',
      }),
      now: new Date('2026-05-21T07:30:00.000Z'),
      supabase: supabase as unknown as SavingsAutoDebitDatabaseClient,
    });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(transactionInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 20000,
        gateway: 'paystack',
        gateway_reference: 'SVG-111111111111-2026-05-21',
        metadata: expect.objectContaining({
          idempotency_key:
            'savings:11111111-1111-4111-8111-111111111111:2026-05-21',
          transaction_type: 'savings_auto_debit',
        }),
      })
    );
    expect(chargeAuthorizationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2_000_000,
        authorization_code: 'AUTH_saved',
        email: 'jane@example.com',
      })
    );
    expect(creditWalletTopUpFn).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 20000,
        customerId: 'customer-1',
        gateway: 'paystack',
        merchantId: 'merchant-1',
        transactionId: 'txn-1',
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'allocate_customer_savings_contribution',
      expect.objectContaining({
        p_amount: 20000,
        p_goal_id: '11111111-1111-4111-8111-111111111111',
        p_idempotency_key:
          'savings:11111111-1111-4111-8111-111111111111:2026-05-21',
        p_source_id: 'txn-1',
        p_source_type: 'paystack_authorization',
      })
    );
  });

  it('stops before wallet credit when transaction status update fails', async () => {
    const transactionInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'txn-1' },
      error: null,
    });
    const contributionInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'contribution-1' },
      error: null,
    });
    const transactionUpdateEq = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'Update failed' } });
    const contributionUpdateEq = vi
      .fn()
      .mockResolvedValue({ data: null, error: null });
    const transactionInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: transactionInsertSingle }),
    });
    const contributionInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: contributionInsertSingle }),
    });

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customer_savings_goals') {
          return createChain({
            data: [
              {
                contribution_amount: '20000',
                contribution_frequency: 'daily',
                current_amount: '100000',
                customer_id: 'customer-1',
                id: '11111111-1111-4111-8111-111111111111',
                maturity_date: '2026-06-30',
                merchant_id: 'merchant-1',
                preferred_debit_time: '06:20:00',
                saved_payment_method_id: 'payment-method-1',
                start_date: '2026-05-20',
                target_amount: '800000',
              },
            ],
            error: null,
          });
        }

        if (table === 'customer_savings_contributions') {
          return {
            insert: contributionInsert,
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnValue({ eq: contributionUpdateEq }),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }

        if (table === 'transactions') {
          return {
            insert: transactionInsert,
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnValue({ eq: transactionUpdateEq }),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }

        return createChain({ data: null, error: null });
      }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const creditWalletTopUpFn = vi.fn();

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
      creditWalletTopUpFn,
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
      reason: expect.stringContaining(
        'Failed to update savings auto-debit transaction txn-1'
      ),
    });
    expect(creditWalletTopUpFn).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'allocate_customer_savings_contribution',
      expect.anything()
    );
  });
});
