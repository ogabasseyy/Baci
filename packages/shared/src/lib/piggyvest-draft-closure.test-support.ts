import { piggyvestDraftClosureSchemas as schemas } from '../contracts/piggyvest-draft-closure';
import { piggyvestSavingsScreenSchema } from '../contracts/piggyvest-savings-screen';
import { createPiggyvestDraftClosureController } from './piggyvest-draft-closure-controller';

export async function draftClosureReviewFixture() {
  const goalId = 'abcdefab-0000-4000-8000-000000000816';
  const source = piggyvestSavingsScreenSchema.parse({
    environment: 'staging',
    status: 'ready',
    sessionKey: 'synthetic',
    goalId,
    policy: {
      status: 'draft',
      goalId,
      revisionId: goalId,
      device: { productName: 'Synthetic', variant: null, condition: 'New' },
      terms: {
        version: 'synthetic',
        hash: 'a'.repeat(64),
        text: '<b>Plain fixture terms</b>',
      },
      consent: 'accepted',
    },
    eligibility: { status: 'blocked' },
    funding: { status: 'unavailable' },
    progress: { status: 'unavailable' },
  });
  const available = {
    status: 'available',
    goalId,
    revisionId: goalId,
    termsVersion: 'synthetic',
    termsHash: 'a'.repeat(64),
    action: 'close_plan',
  };
  let response = schemas.response.parse(available);
  let lose = false;
  let calls = 0;
  const binding = createPiggyvestDraftClosureController({
    source,
    tenantKey: 'synthetic',
    operationId: goalId,
    isCurrent: () => true,
    read: () => Promise.resolve(response),
    close: async () => {
      await Promise.resolve();
      calls++;
      response = schemas.response.parse({
        ...available,
        status: 'closed',
        operationId: goalId,
        closedAt: '2026-09-12T00:00:00Z',
        refundIssued: false,
        providerWalletDeleted: false,
      });
      if (lose) throw new Error('Synthetic response loss');
      return response;
    },
  });
  await binding.refresh();
  return {
    source,
    binding,
    calls: () => calls,
    loseResponse() {
      lose = true;
    },
    mapped() {
      response = schemas.response.parse({
        status: 'requires_reconciliation',
        goalId,
        reason: 'provider_zero_unverified',
      });
    },
  };
}
