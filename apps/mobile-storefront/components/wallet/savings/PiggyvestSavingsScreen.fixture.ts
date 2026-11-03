import { jest } from '@jest/globals';
import type { PiggyvestSavingsScreenInput } from './PiggyvestSavingsScreen.types';

export const goalId = '11111111-1111-4111-8111-111111111111';
export const revisionId = '22222222-2222-4222-8222-222222222222';
const device = {
  productName: 'Synthetic phone',
  variant: '256GB',
  condition: 'New',
};
export const policy = {
  status: 'draft',
  goalId,
  revisionId,
  device,
  terms: {
    version: 'synthetic-v1',
    hash: 'a'.repeat(64),
    text: 'Synthetic reviewed terms only.',
  },
  consent: 'required',
} as const;
export function fixture(): PiggyvestSavingsScreenInput & {
  source: Extract<
    NonNullable<PiggyvestSavingsScreenInput['source']>,
    { status: 'ready' }
  >;
} {
  return {
    environment: 'staging',
    sessionKey: 'synthetic-session',
    goalId,
    source: {
      environment: 'staging',
      status: 'ready',
      sessionKey: 'synthetic-session',
      goalId,
      policy,
      eligibility: {
        status: 'allowed',
        sessionKey: 'synthetic-session',
        goalId,
        revisionId,
        termsHash: policy.terms.hash,
        termsVersion: policy.terms.version,
      },
      progress: {
        status: 'ready',
        decision: {
          purchasingPowerKobo: 12345,
          devicePriceKobo: 50000,
          readiness: 'continue_saving',
          purchaseAction: 'blocked',
        },
        pendingInterestKobo: 500,
      },
      funding: {
        status: 'ready',
        accounts: [
          {
            accountNumber: '0000000000',
            accountName: 'Synthetic account',
            bankName: 'Synthetic test bank',
          },
        ],
      },
    },
    onAccept: jest.fn(async () => undefined),
  };
}
