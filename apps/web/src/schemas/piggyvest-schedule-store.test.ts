import { expect, it } from 'vitest';
import { piggyvestScheduleStoreSchemas as schemas } from './piggyvest-schedule-store';

const identity = '10000000-0000-4000-8000-000000000001';
it('accepts pause but rejects mismatched resume operation and client authority', () => {
  const command = { action: 'pause', expectedVersion: 0, goalId: identity };
  expect(
    schemas.request.safeParse({ operationId: identity, command }).success
  ).toBe(true);
  expect(
    schemas.request.safeParse({
      operationId: identity,
      command,
      actorId: identity,
    }).success
  ).toBe(false);
  expect(
    schemas.request.safeParse({
      operationId: identity,
      command: {
        ...command,
        action: 'request_resume',
        accepted: true,
        operationId: '20000000-0000-4000-8000-000000000001',
        revisionId: identity,
        termsHash: 'a'.repeat(64),
      },
    }).success
  ).toBe(false);
});

it('rejects a financial permission masquerading as a persisted proposal receipt', () => {
  expect(
    schemas.receipt.safeParse({
      operationId: identity,
      persisted: true,
      dispatch: 'enabled',
      debitPermission: true,
    }).success
  ).toBe(false);
  expect(schemas.writeRows.safeParse([]).success).toBe(false);
});
