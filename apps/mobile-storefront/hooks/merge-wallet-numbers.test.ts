import { mergeWalletNumbers } from './merge-wallet-numbers';
import { walletGoalMetadata } from './wallet-goal-metadata';
import type { WalletNumbers } from './wallet-number.types';
import type { WalletQueryData } from './wallet-query';

const goal = {
  id: 'goal-1',
  current_amount: 200,
  target_amount: 1000,
  status: 'active' as const,
  contribution_amount: 100,
  contribution_frequency: 'monthly' as const,
  maturity_date: '2026-11-01',
  title: 'Phone',
  source_mode: 'manual' as const,
  product_image: 'https://example.com/phone.png',
  product_variant_label: 'Blue',
};
const cached: WalletQueryData = {
  goalMetadata: {
    [goal.id]:
      walletGoalMetadata({
        id: goal.id,
        product_id: 'product-1',
        variant_id: 'variant-1',
        title: goal.title,
        product_snapshot: { storage: '128GB' },
        target_amount: goal.target_amount,
        contribution_amount: goal.contribution_amount,
        contribution_frequency: goal.contribution_frequency,
        source_mode: goal.source_mode,
        status: goal.status,
        maturity_date: goal.maturity_date,
      }) ?? '',
  },
  wallet: {
    balance: 0,
    loyalty_points: 0,
    savings_balance: 200,
    total_balance: 200,
    savings_goals: [goal],
    active_savings_goal: goal,
    funding_account: {
      provider: 'piggyvest',
      account_name: 'Test',
      account_number: '1234567890',
      bank_name: 'Sandbox',
    },
  },
  transactions: [],
};
const fresh: WalletNumbers = {
  wallet: {
    balance: 100,
    savings_balance: 205,
    total_balance: 305,
    earnings_balance: 5,
    earnings_available: true,
    loyalty_points: 10,
  },
  goals: [
    {
      id: goal.id,
      current_amount: 205,
      target_amount: 1000,
      status: 'active',
      metadata:
        walletGoalMetadata({
          id: goal.id,
          product_id: 'product-1',
          variant_id: 'variant-1',
          title: goal.title,
          product_snapshot: { storage: '128GB' },
          target_amount: goal.target_amount,
          contribution_amount: goal.contribution_amount,
          contribution_frequency: goal.contribution_frequency,
          source_mode: goal.source_mode,
          status: goal.status,
          maturity_date: goal.maturity_date,
        }) ?? '',
    },
  ],
};

it('updates numbers and both goal projections without replacing account, products or history', () => {
  const merged = mergeWalletNumbers(cached, fresh);
  expect(merged?.wallet).toMatchObject(fresh.wallet);
  expect(merged?.wallet.active_savings_goal).toEqual({
    ...goal,
    current_amount: 205,
  });
  expect(merged?.wallet.savings_goals).toEqual([
    { ...goal, current_amount: 205 },
  ]);
  expect(merged?.wallet.funding_account).toBe(cached.wallet.funding_account);
  expect(merged?.transactions).toBe(cached.transactions);
  expect(cached.wallet.active_savings_goal?.current_amount).toBe(200);
});

it.each([
  { ...fresh, goals: [] },
  { ...fresh, goals: [...fresh.goals, { ...fresh.goals[0], id: 'goal-2' }] },
  { ...fresh, goals: [{ ...fresh.goals[0], status: 'completed' as const }] },
  { ...fresh, goals: [{ ...fresh.goals[0], target_amount: 2000 }] },
  null,
])('requires a full reload when goal structure or owner resolution changes', (snapshot) => {
  expect(mergeWalletNumbers(cached, snapshot)).toBeNull();
});

it('requires a full reload when an equal-target product or variant changes', () => {
  const swapped = {
    ...fresh,
    goals: [
      {
        ...fresh.goals[0],
        metadata:
          walletGoalMetadata({
            id: goal.id,
            product_id: 'product-2',
            variant_id: 'variant-2',
            title: 'Different phone',
            product_snapshot: { storage: '256GB' },
            target_amount: goal.target_amount,
            contribution_amount: goal.contribution_amount,
            contribution_frequency: goal.contribution_frequency,
            source_mode: goal.source_mode,
            status: goal.status,
            maturity_date: goal.maturity_date,
          }) ?? '',
      },
    ],
  };
  expect(mergeWalletNumbers(cached, swapped)).toBeNull();
});
