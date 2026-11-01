import { mergeSavingsHistory } from './merge-savings-history';
import type { Transaction } from './wallet-query';

const bank: Transaction = {
  id: 'bank',
  type: 'credit',
  amount: 100,
  description: 'Bank transfer',
  created_at: '2026-10-12T08:00:00Z',
  source_type: 'wallet_topup',
};
const interest: Transaction = {
  id: 'interest',
  type: 'credit',
  amount: 7.33,
  description: 'Savings interest credited',
  created_at: '2026-10-13T08:00:00Z',
  source_type: 'savings_interest',
  goal_id: 'goal-1',
};

it('shows paid interest alongside bank transfers exactly once and links its receiving plan', () => {
  expect(mergeSavingsHistory([bank, interest], [interest, interest])).toEqual([
    interest,
    bank,
  ]);
});
it('removes stale interest when a fresh authoritative history is empty', () => {
  expect(mergeSavingsHistory([interest, bank], [])).toEqual([bank]);
});
it('preserves cached history if the old backend has no interest history', () => {
  expect(mergeSavingsHistory([interest, bank], undefined)).toEqual([
    interest,
    bank,
  ]);
});
it('keeps undated legacy reversals visible after dated activity without inventing a date', () => {
  const undated: Transaction = {
    ...interest,
    id: 'undated-reversal',
    type: 'adjustment',
    amount: -2,
    created_at: null,
  };
  expect(mergeSavingsHistory([undated, bank], [undated, bank])).toEqual([
    bank,
    undated,
  ]);
  expect(undated.created_at).toBeNull();
});
it('keeps all ledger entries without changing signed reversal amounts', () => {
  const reversal: Transaction = {
    ...interest,
    id: 'reversal',
    type: 'adjustment',
    amount: -7.33,
  };
  expect(mergeSavingsHistory([bank], [reversal])[0].amount).toBe(-7.33);
  expect(
    mergeSavingsHistory(
      Array.from({ length: 25 }, (_, index) => ({
        ...bank,
        id: `bank-${index}`,
      })),
      [interest]
    )
  ).toHaveLength(26);
});

it('preserves a wallet funding credit behind twenty newer interest entries for confirmation', () => {
  const newerInterest = Array.from({ length: 20 }, (_, index) => ({
    ...interest,
    id: `interest-${index}`,
  }));
  const merged = mergeSavingsHistory([bank], newerInterest);
  expect(merged).toHaveLength(21);
  expect(merged).toContainEqual(bank);
});
