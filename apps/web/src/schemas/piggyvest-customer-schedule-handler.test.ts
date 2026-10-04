import { expect, it } from 'vitest';
import { piggyvestCustomerScheduleHandlerSchemas as schemas } from './piggyvest-customer-schedule-handler';

const goalId = '30000000-0000-4000-8000-000000000101';
it('accepts only goal and optional operation on reads', () => {
  expect(schemas.read.parse({ goalId })).toEqual({ goalId });
  expect(schemas.read.safeParse({ goalId, actorId: goalId }).success).toBe(
    false
  );
  expect(schemas.read.safeParse({ goalId, operationId: 'bad' }).success).toBe(
    false
  );
});
it('requires correlated operation and explicit consent without accepting server fields', () => {
  const command = {
    action: 'request_resume',
    expectedVersion: 0,
    goalId,
    operationId: goalId,
    revisionId: goalId,
    termsHash: 'a'.repeat(64),
    accepted: true,
  };
  expect(
    schemas.request.safeParse({ operationId: goalId, command }).success
  ).toBe(true);
  expect(
    schemas.request.safeParse({
      operationId: goalId,
      command: { ...command, accepted: false },
    }).success
  ).toBe(false);
  expect(
    schemas.request.safeParse({ operationId: goalId, command, proposal: {} })
      .success
  ).toBe(false);
});
it('strips internal receipt scope and actor and cannot grant debit permission', () => {
  const input = {
    status: 'persisted_proposal',
    goalId,
    dispatch: 'disabled',
    debitPermission: false,
    receipt: {
      operationId: goalId,
      persisted: true,
      dispatch: 'disabled',
      debitPermission: false,
      state: {
        version: 1,
        status: 'resume_proposed',
        scope: { private: true },
        consentProposal: {
          operationId: goalId,
          revisionId: goalId,
          termsHash: 'a'.repeat(64),
          actorId: goalId,
        },
      },
    },
  };
  expect(JSON.stringify(schemas.success.parse(input))).not.toMatch(
    /actorId|scope|private/
  );
  expect(
    schemas.success.safeParse({ ...input, debitPermission: true }).success
  ).toBe(false);
});
