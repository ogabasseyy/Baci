import { describe, expect, it } from 'vitest';
import { piggyvestGoalPolicySchemas as schemas } from './piggyvest-goal-policy';

describe('goal policy persistence schemas', () => {
  it('preserves optional exact duration without manufacturing a default', () => {
    const input = {
      revisionId: '70000000-0000-4000-8000-000000000001',
      actorId: '90000000-0000-4000-8000-000000000001',
    };
    expect(schemas.acceptance.parse(input)).not.toHaveProperty(
      'durationMonths'
    );
    expect(
      schemas.acceptance.parse({ ...input, durationMonths: 1 })
    ).toMatchObject({ durationMonths: 1 });
    for (const durationMonths of [null, 0, 1.5, 7, '1'])
      expect(
        schemas.acceptance.safeParse({ ...input, durationMonths }).success
      ).toBe(false);
  });
  it('requires explicit scope and never enables production configuration', () => {
    expect(
      schemas.configuration.safeParse({ environment: 'production' }).success
    ).toBe(false);
    expect(
      schemas.configuration.safeParse({ environment: 'staging' }).success
    ).toBe(false);
  });
  it('rejects invented timestamps and legacy acceptance flags', () => {
    const accepted = {
      revisionId: '70000000-0000-4000-8000-000000000001',
      actorId: '90000000-0000-4000-8000-000000000001',
    };
    expect(schemas.acceptance.parse(accepted)).toEqual(accepted);
    expect(
      schemas.acceptance.safeParse({ ...accepted, acceptedAt: '2020-01-01' })
        .success
    ).toBe(false);
    expect(
      schemas.acceptance.safeParse({ ...accepted, termsAccepted: true }).success
    ).toBe(false);
  });
  it('rejects missing or ambiguous recorded results', () => {
    expect(schemas.staged.safeParse([]).success).toBe(false);
    expect(
      schemas.accepted.safeParse([
        {
          result: {
            revisionId: '70000000-0000-4000-8000-000000000001',
            outcome: 'activated',
          },
        },
      ]).success
    ).toBe(false);
  });
});
