import { vi } from 'vitest';
import type {
  DueSavingsGoalRow,
  ExistingContributionRow,
} from './customer-savings-auto-debit-types';

export function createChain(result: unknown) {
  const chain = {
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue(result),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    update: vi.fn().mockReturnThis(),
  };
  return chain;
}

export const baseDueGoal: DueSavingsGoalRow = {
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
};

export function createAutoDebitSupabase({
  allocationError = null,
  existingContribution = null,
  goalPages,
  goals = [baseDueGoal],
  primaryBoundGoalIds = [],
}: {
  allocationError?: { message: string } | null;
  existingContribution?: ExistingContributionRow | null;
  goalPages?: DueSavingsGoalRow[][];
  goals?: DueSavingsGoalRow[];
  primaryBoundGoalIds?: string[];
} = {}) {
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
    .mockResolvedValue({ data: null, error: null });
  const contributionUpdateEq = vi
    .fn()
    .mockResolvedValue({ data: null, error: null });
  const transactionInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: transactionInsertSingle }),
  });
  const contributionInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: contributionInsertSingle }),
  });
  const reconciliationInsert = vi
    .fn()
    .mockResolvedValue({ data: null, error: null });
  let goalPageIndex = 0;

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'customer_savings_goals') {
        const chain = createChain({ data: goals, error: null });
        chain.range.mockImplementation(() =>
          Promise.resolve({
            data: goalPages?.[goalPageIndex++] ?? goals,
            error: null,
          })
        );
        return chain;
      }

      if (table === 'customer_savings_contributions') {
        return {
          eq: vi.fn().mockReturnThis(),
          insert: contributionInsert,
          maybeSingle: vi.fn().mockResolvedValue({
            data: existingContribution,
            error: null,
          }),
          select: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnValue({ eq: contributionUpdateEq }),
        };
      }

      if (table === 'transactions') {
        return {
          eq: vi.fn().mockReturnThis(),
          insert: transactionInsert,
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          select: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnValue({ eq: transactionUpdateEq }),
        };
      }

      if (table === 'reconciliation_review') {
        return { insert: reconciliationInsert };
      }

      return createChain({ data: null, error: null });
    }),
    rpc: vi.fn(async (name: string) =>
      name === 'savings_goal_ids_bound_to_primary'
        ? { data: primaryBoundGoalIds, error: null }
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
            error: allocationError,
          }
    ),
  };

  return {
    contributionInsert,
    contributionUpdateEq,
    reconciliationInsert,
    supabase,
    transactionInsert,
    transactionUpdateEq,
  };
}
