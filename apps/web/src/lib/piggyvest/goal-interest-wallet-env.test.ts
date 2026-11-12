import { expect, it } from 'vitest';
import { readGoalInterestWalletId } from './goal-interest-wallet-env';

const env = (value?: string) =>
  ({ PIGGYVEST_INTEREST_WALLET_ID: value }) as unknown as NodeJS.ProcessEnv;

it('reads the configured interest wallet id', () => {
  expect(readGoalInterestWalletId(env(' interest-wallet '))).toBe(
    'interest-wallet'
  );
});

it('treats an unset or blank setting as no interest wallet', () => {
  expect(readGoalInterestWalletId(env(undefined))).toBeNull();
  expect(readGoalInterestWalletId(env('   '))).toBeNull();
});
