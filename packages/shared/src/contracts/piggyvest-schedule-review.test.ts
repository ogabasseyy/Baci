import { describe, expect, it } from 'vitest';
import { piggyvestScheduleReviewSchemas as schemas } from './piggyvest-schedule-review';

const goalId = '11111111-1111-4111-8111-111111111111';
const command = { action: 'pause', goalId, expectedVersion: 0 };
describe('schedule public protocol', () => {
  it('accepts existing strict commands without granting debit permission', () => {
    expect(schemas.request.parse({ operationId: goalId, command })).toEqual({
      operationId: goalId,
      command,
    });
  });
  it.each([
    'actorId',
    'source',
    'token',
    'proposal',
    'cadence',
  ])('rejects client authority %s', (key) => {
    expect(
      schemas.request.safeParse({
        operationId: goalId,
        command,
        [key]: 'untrusted',
      }).success
    ).toBe(false);
    expect(
      schemas.command.safeParse({ ...command, [key]: 'untrusted' }).success
    ).toBe(false);
  });
  it('rejects mismatched resume operation and malformed consent state', () => {
    expect(
      schemas.request.safeParse({
        operationId: goalId,
        command: {
          ...command,
          action: 'request_resume',
          operationId: '22222222-2222-4222-8222-222222222222',
          accepted: true,
          revisionId: goalId,
          termsHash: 'a'.repeat(64),
        },
      }).success
    ).toBe(false);
    expect(
      schemas.state.safeParse({
        version: 0,
        status: 'resume_proposed',
        consentProposal: null,
      }).success
    ).toBe(false);
    expect(
      schemas.state.safeParse({
        version: 0,
        status: 'paused',
        consentProposal: null,
        scope: {},
      }).success
    ).toBe(false);
  });
});
