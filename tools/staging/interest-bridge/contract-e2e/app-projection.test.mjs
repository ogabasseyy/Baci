import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { CONTRACT_E2E } from './constants.mjs';
import { createSourceLoader } from './source-loader.mjs';

test('real mobile goal projection adds only confirmed net kobo without mutating principal', () => {
  const loader = createSourceLoader([CONTRACT_E2E.canonicalRoot]);
  const { projectWalletSavingsInterest } = loader.load(
    resolve(
      CONTRACT_E2E.canonicalRoot,
      'apps/mobile-storefront/hooks/wallet-savings-interest-projection.ts'
    )
  );
  const goal = {
    id: CONTRACT_E2E.goalId,
    status: 'active',
    current_amount: 100,
  };
  const result = projectWalletSavingsInterest({
    goals: [goal],
    goalInterestKobo: [{ goal_id: goal.id, credited_interest_kobo: 733 }],
  });
  assert.equal(result.savingsBalance, 107.33);
  assert.equal(result.appliedInterestKobo, 733);
  assert.equal(goal.current_amount, 100);
  const foreign = projectWalletSavingsInterest({
    goals: [goal],
    goalInterestKobo: [
      { goal_id: CONTRACT_E2E.customerId, credited_interest_kobo: 733 },
    ],
  });
  assert.equal(foreign.savingsBalance, 100);
  assert.equal(foreign.appliedInterestKobo, 0);
});
