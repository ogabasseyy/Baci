import { expect, it } from 'vitest';
import {
  readGoalInterestWalletId,
  readGoalInterestWalletOwnerId,
} from './goal-interest-wallet-env';

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

it('reads the interest wallet owner id, unset meaning none', () => {
  expect(
    readGoalInterestWalletOwnerId({
      PIGGYVEST_INTEREST_WALLET_OWNER_ID: ' ogabassey ',
    } as unknown as NodeJS.ProcessEnv)
  ).toBe('ogabassey');
  expect(
    readGoalInterestWalletOwnerId({} as unknown as NodeJS.ProcessEnv)
  ).toBeNull();
});

it('treats a blank owner id as unset (business-owned interest wallet)', () => {
  expect(
    readGoalInterestWalletOwnerId({
      PIGGYVEST_INTEREST_WALLET_OWNER_ID: '   ',
    } as unknown as NodeJS.ProcessEnv)
  ).toBeNull();
});

it('never reads a set but invalid owner id as unset', () => {
  const owner = readGoalInterestWalletOwnerId({
    PIGGYVEST_INTEREST_WALLET_OWNER_ID: 'bad\0id',
  } as unknown as NodeJS.ProcessEnv);
  expect(owner).not.toBeNull();
  expect(owner).not.toBe('bad\0id');
});
