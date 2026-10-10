import { expect, it, vi } from 'vitest';
import { planPiggyvestScheduleLifecycle as plan } from './schedule-lifecycle';
import { scheduleLifecycleFixture } from './schedule-lifecycle.test-support';

vi.mock('server-only', () => ({}));

function proposed() {
  const input = scheduleLifecycleFixture();
  const command = {
    ...input.command,
    action: 'request_resume',
    accepted: true,
    operationId: '70000000-0000-4000-8000-000000000001',
    revisionId: input.trusted.revisionId,
    termsHash: input.trusted.termsHash,
  };
  return {
    ...input,
    state: plan({ ...input, command }).stateProposal,
    command: { ...input.command, expectedVersion: 1 },
  };
}

it('requires fresh explicit consent after pause and offer expiry', () => {
  const input = proposed();
  const protectedOffer = {
    version: 'synthetic-protected-offer',
    device: input.trusted.policy.device,
    priceKobo: 100,
    expiresAt: '2026-09-19T09:00:00Z',
  };
  const ready = plan({
    ...input,
    trusted: {
      ...input.trusted,
      policy: {
        ...input.trusted.policy,
        protectedOffer,
      },
    },
  });
  expect(ready.stateProposal.status).toBe('paused');
  const observed = plan({
    ...input,
    trusted: {
      ...input.trusted,
      policy: {
        ...input.trusted.policy,
        protectedOffer,
        now: protectedOffer.expiresAt,
      },
    },
    state: ready.stateProposal,
    command: { ...input.command, expectedVersion: ready.stateProposal.version },
  });
  expect(observed.stateProposal).toEqual(ready.stateProposal);
  expect(observed.collectionPaused).toBe(true);
  const paused = plan({
    ...input,
    command: { ...input.command, action: 'pause' },
  });
  expect(paused.stateProposal).toMatchObject({
    status: 'paused',
    consentProposal: null,
  });
});

it.each([
  ['2026-10-12T08:59:59Z', 'before_maturity'],
  ['2026-10-12T09:00:00Z', 'within_grace'],
  ['2026-11-11T08:59:59Z', 'within_grace'],
  ['2026-11-11T09:00:00Z', 'review_required'],
])('projects persisted maturity/grace at %s without any collection due claims', (now, maturity) => {
  const input = proposed();
  const result = plan({
    ...input,
    trusted: { ...input.trusted, policy: { ...input.trusted.policy, now } },
  });
  expect(result).toMatchObject({
    maturity,
    collectionPaused: true,
    due: 'cadence_contract_unresolved',
    dispatch: 'disabled',
    persisted: false,
  });
  if (maturity !== 'before_maturity')
    expect(result.stateProposal.consentProposal).toBeNull();
});

it('revokes stale actor, revision or hash proposals without automatically resuming', () => {
  const input = proposed();
  for (const change of [
    { actorId: '50000000-0000-4000-8000-000000000002' },
    { revisionId: '60000000-0000-4000-8000-000000000002' },
    { termsHash: 'b'.repeat(64) },
  ]) {
    expect(
      plan({ ...input, trusted: { ...input.trusted, ...change } }).stateProposal
    ).toMatchObject({ status: 'paused', consentProposal: null });
  }
});

it('keeps Paystack and unassigned ownership disabled without touching their transport', () => {
  const input = proposed();
  for (const collectionOwner of ['paystack', 'none']) {
    expect(
      plan({ ...input, trusted: { ...input.trusted, collectionOwner } })
    ).toMatchObject({
      reason: 'collection_owner_not_piggyvest',
      collectionPaused: true,
      stateProposal: { status: 'paused' },
    });
  }
});

it('uses existing policy reversal and reservation blockers', () => {
  const input = proposed();
  expect(
    plan({
      ...input,
      trusted: {
        ...input.trusted,
        policy: { ...input.trusted.policy, fundingReversed: true },
      },
    }).stateProposal.status
  ).toBe('review_required');
  expect(
    plan({
      ...input,
      trusted: {
        ...input.trusted,
        policy: { ...input.trusted.policy, reservation: 'cancellation' },
      },
    }).stateProposal.status
  ).toBe('stopped');
});

it('does not mutate inputs or claim persistence on repeated observation', () => {
  const input = proposed();
  const original = structuredClone(input);
  expect(plan(input)).toEqual(plan(input));
  expect(input).toEqual(original);
  expect(plan(input).stateProposal.version).toBe(1);
});

it('fails closed on cross-scope, stale versions, overflow and mismatched resume terms', () => {
  const input = proposed();
  for (const key of [
    'integrationId',
    'merchantId',
    'customerId',
    'goalId',
  ] as const) {
    expect(() =>
      plan({
        ...input,
        state: {
          ...input.state,
          scope: {
            ...input.state.scope,
            [key]: '80000000-0000-4000-8000-000000000099',
          },
        },
      })
    ).toThrow('Schedule lifecycle proposal unavailable');
  }
  expect(() =>
    plan({ ...input, command: { ...input.command, expectedVersion: 0 } })
  ).toThrow();
  expect(() =>
    plan({
      ...input,
      state: { ...input.state, version: Number.MAX_SAFE_INTEGER },
      command: {
        ...input.command,
        expectedVersion: Number.MAX_SAFE_INTEGER,
        action: 'pause',
      },
    })
  ).toThrow();
  for (const change of [
    { termsHash: 'b'.repeat(64) },
    { revisionId: input.trusted.actorId },
  ]) {
    expect(() =>
      plan({
        ...input,
        command: {
          ...input.command,
          action: 'request_resume',
          accepted: true,
          operationId: input.trusted.actorId,
          revisionId: input.trusted.revisionId,
          termsHash: input.trusted.termsHash,
          ...change,
        },
      })
    ).toThrow();
  }
});
