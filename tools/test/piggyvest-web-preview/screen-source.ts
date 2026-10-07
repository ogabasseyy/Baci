import type { SavingsScreenSource } from '../../../apps/web/src/components/storefront/piggyvest-savings/savings-screen.types';

type ReadySource = Extract<SavingsScreenSource, { status: 'ready' }>;

export function createScreenSource({
  policy,
  session,
  eligibility,
  funding,
  progress,
}: {
  policy: ReadySource['policy'];
  session: boolean;
  eligibility: ReadySource['eligibility']['status'];
  funding: 'ready' | 'pending' | 'unavailable';
  progress: 'ready' | 'loading' | 'pending_wallet' | 'unavailable';
}): SavingsScreenSource {
  if (!session) return { environment: 'staging', status: 'unauthenticated' };
  const sessionKey = `synthetic-session:${policy.goalId}`;
  return {
    environment: 'staging',
    status: 'ready',
    sessionKey,
    goalId: policy.goalId,
    policy,
    eligibility:
      eligibility === 'allowed'
        ? policy.consent === 'accepted'
          ? {
              status: 'allowed',
              sessionKey,
              goalId: policy.goalId,
              revisionId: policy.revisionId,
              termsHash: policy.terms.hash,
              termsVersion: policy.terms.version,
            }
          : { status: 'blocked' }
        : { status: eligibility },
    funding:
      funding === 'ready'
        ? {
            status: 'ready',
            accounts: [
              {
                accountNumber: 'NOT-A-BANK-ACCOUNT',
                accountName: 'SYNTHETIC QA ONLY',
                bankName: 'NO REAL BANK — TEST FIXTURE',
              },
            ],
          }
        : { status: funding },
    progress:
      progress === 'ready'
        ? {
            status: 'ready',
            decision: {
              purchasingPowerKobo: 250000,
              devicePriceKobo: 1000000,
              readiness: 'continue_saving',
              purchaseAction: 'blocked',
            },
            pendingInterestKobo: 1200,
          }
        : { status: progress },
  };
}
