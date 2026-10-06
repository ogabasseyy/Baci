import { describe, expect, it } from 'vitest';
import { reconciliationCasesSchemas } from './reconciliation-cases';

const uuid = '00000000-0000-4000-8000-000000000000';

describe('reconciliationCasesSchemas', () => {
  it('accepts a collection request and a paged request', () => {
    expect(
      reconciliationCasesSchemas.request.safeParse({
        goalId: uuid,
        collectionOperationId: uuid,
      }).success
    ).toBe(true);
    expect(
      reconciliationCasesSchemas.request.safeParse({
        goalId: uuid,
        after: null,
      }).success
    ).toBe(true);
  });

  it('accepts an absent-case read row', () => {
    expect(
      reconciliationCasesSchemas.readRows.safeParse([
        {
          result: {
            status: 'absent',
            caseId: uuid,
            goalId: uuid,
            financialEffects: 'UNKNOWN',
            fundsUse: 'not_authorized',
            dispatch: 'disabled',
          },
        },
      ]).success
    ).toBe(true);
  });

  it('accepts a case list row', () => {
    expect(
      reconciliationCasesSchemas.listRows.safeParse([
        { result: { goalId: uuid, cases: [{ caseId: uuid }] } },
      ]).success
    ).toBe(true);
  });
});
