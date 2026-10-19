import { describe, expect, it, vi } from 'vitest';
import { planPiggyvestScheduleLifecycle as plan } from './schedule-lifecycle';
import { scheduleLifecycleFixture } from './schedule-lifecycle.test-support';

vi.mock('server-only', () => ({}));

describe('local scheduling intent, never collection permission', () => {
  it('validates an exact resume proposal but keeps dispatch and cadence disabled', () => {
    const input = scheduleLifecycleFixture();
    const result = plan({
      ...input,
      command: {
        ...input.command,
        action: 'request_resume',
        accepted: true,
        operationId: '70000000-0000-4000-8000-000000000001',
        revisionId: input.trusted.revisionId,
        termsHash: input.trusted.termsHash,
      },
    });
    expect(result).toMatchObject({
      stateProposal: {
        status: 'resume_proposed',
        version: 1,
        consentProposal: { actorId: input.trusted.actorId },
      },
      collectionPaused: true,
      dispatch: 'disabled',
      due: 'cadence_contract_unresolved',
      persisted: false,
    });
  });

  it.each([
    'cancellation_pending',
    'cancelled',
    'purchase_pending',
    'purchased',
  ])('stops collection proposals for %s and never reopens on late credit', (goalState) => {
    const input = scheduleLifecycleFixture();
    const stopped = plan({
      ...input,
      trusted: {
        ...input.trusted,
        policy: {
          ...input.trusted.policy,
          goalState,
          ledger: {
            ...input.trusted.policy.ledger,
            confirmedPrincipalKobo: 500,
          },
        },
      },
    });
    expect(stopped).toMatchObject({
      stateProposal: { status: 'stopped', consentProposal: null },
      collectionPaused: true,
    });
    expect(
      plan({
        ...input,
        state: stopped.stateProposal,
        command: {
          ...input.command,
          expectedVersion: stopped.stateProposal.version,
        },
      })
    ).toMatchObject({ stateProposal: { status: 'stopped' } });
  });
});
