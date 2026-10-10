import { describe, expect, it, vi } from 'vitest';
import { planPiggyvestScheduleLifecycle as plan } from './schedule-lifecycle';
import { scheduleLifecycleFixture } from './schedule-lifecycle.test-support';

vi.mock('server-only', () => ({}));

describe('accepted quote expiry invalidates scheduling proposals', () => {
  it.each([
    'draft',
    'active',
  ] as const)('clears consent exactly at expiry for %s without activation inference', (goalState) => {
    const fixture = scheduleLifecycleFixture();
    const operationId = '70000000-0000-4000-8000-000000000001';
    const trusted = {
      ...fixture.trusted,
      maturity: goalState === 'draft' ? null : fixture.trusted.maturity,
      policy: {
        ...fixture.trusted.policy,
        goalState,
        maturityGraceExpiresAt:
          goalState === 'draft'
            ? undefined
            : fixture.trusted.policy.maturityGraceExpiresAt,
        activationQuote: {
          version: 'accepted-quote',
          device: fixture.trusted.policy.device,
          priceKobo: 10000,
          expiresAt: fixture.trusted.policy.now,
        },
      },
    };
    const resume = {
      action: 'request_resume',
      goalId: fixture.state.scope.goalId,
      expectedVersion: 0,
      operationId,
      accepted: true,
      revisionId: trusted.revisionId,
      termsHash: trusted.termsHash,
    };
    const before = plan({
      ...fixture,
      trusted: {
        ...trusted,
        policy: { ...trusted.policy, now: '2026-09-12T08:59:59.999Z' },
      },
      command: resume,
    });
    expect(before.stateProposal.status).toBe('resume_proposed');
    const observed = plan({
      trusted,
      state: before.stateProposal,
      command: { ...fixture.command, expectedVersion: 1 },
    });
    expect(observed).toMatchObject({
      persisted: false,
      dispatch: 'disabled',
      stateProposal: { version: 2, status: 'paused', consentProposal: null },
    });
  });
});
