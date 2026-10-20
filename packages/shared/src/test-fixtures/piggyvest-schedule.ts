import { vi } from 'vitest';
import { piggyvestScheduleReviewSchemas as schemas } from '../contracts/piggyvest-schedule-review';

export function scheduleJourneyFixture() {
  const goalId = '11111111-1111-4111-8111-111111111111';
  const source = {
    environment: 'staging',
    status: 'ready',
    sessionKey: 'session',
    goalId,
    policy: {
      status: 'draft',
      goalId,
      revisionId: goalId,
      device: { productName: 'Synthetic', variant: null, condition: 'New' },
      terms: {
        version: 'synthetic',
        hash: 'a'.repeat(64),
        text: '<b>Synthetic plain terms</b>',
      },
      consent: 'accepted',
    },
    eligibility: { status: 'blocked' },
    funding: { status: 'unavailable' },
    progress: { status: 'unavailable' },
  };
  let state: ReturnType<typeof schemas.state.parse> = {
    version: 0,
    status: 'paused',
    consentProposal: null,
  };
  const receipts = new Map<
    string,
    NonNullable<ReturnType<typeof schemas.snapshot.parse>['historical']>
  >();
  let lose = false;
  let invalidated = false;
  let sequence = 0;
  const snapshot = () =>
    schemas.snapshot.parse({
      goalId,
      status: 'available',
      revisionId: goalId,
      termsHash: 'a'.repeat(64),
      state,
      historical: null,
      dispatch: 'disabled',
      debitPermission: false,
    });
  const read = vi.fn(async (operationId?: string) => ({
    ...snapshot(),
    historical: receipts.get(operationId ?? '') ?? null,
  }));
  const submit = vi.fn(
    async (request: ReturnType<typeof schemas.request.parse>) => {
      await Promise.resolve();
      const command = request.command;
      if (command.expectedVersion !== state.version) throw new Error('Stale');
      state = {
        version: state.version + 1,
        status:
          !invalidated && command.action === 'request_resume'
            ? 'resume_proposed'
            : 'paused',
        consentProposal:
          !invalidated && command.action === 'request_resume'
            ? {
                operationId: request.operationId,
                revisionId: command.revisionId,
                termsHash: command.termsHash,
              }
            : null,
      };
      const receipt = schemas.receipt.parse({
        operationId: request.operationId,
        state,
        persisted: true,
        dispatch: 'disabled',
        debitPermission: false,
      });
      receipts.set(request.operationId, { command, receipt });
      if (lose) {
        lose = false;
        throw new Error('Private lost ACK');
      }
      return schemas.result.parse({
        goalId,
        status: 'persisted_proposal',
        receipt,
        dispatch: 'disabled',
        debitPermission: false,
      });
    }
  );
  return {
    goalId,
    source,
    snapshot,
    read,
    submit,
    loseAcknowledgement() {
      lose = true;
    },
    invalidateProposal() {
      invalidated = true;
    },
    options: {
      source,
      tenantKey: 'tenant',
      read,
      submit,
      isCurrent: vi.fn(() => true),
      nextOperationId: vi.fn(
        () => `22222222-2222-4222-8222-${String(++sequence).padStart(12, '0')}`
      ),
    },
  };
}
