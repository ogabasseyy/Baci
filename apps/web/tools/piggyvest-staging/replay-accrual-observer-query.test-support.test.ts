import { expect, it } from 'vitest';
import { createAccrualObserverTestFixture } from './replay-accrual-observer.test-support';
import { accrualObserverQueryResponse } from './replay-accrual-observer-query.test-support';
import { PIGGYVEST_ACCRUAL_OBSERVER_STATEMENTS as statements } from './replay-accrual-observer-statements';

it('keeps mock authority distinct from its embedded identity signature and mutates only observation mock rows', () => {
  const input = {
    sample: createAccrualObserverTestFixture(),
    role: 'piggyvest_staging_ledger_worker',
    sql: statements.authority,
    parameters: ['scope', 'business', 'system', 'receipt', 'hash', '{}'],
    readOnly: true,
    failure: 'authority',
    observations: new Set<string>(),
    paid: new Set<string>(),
  };
  expect(accrualObserverQueryResponse(input)).toMatchObject({
    rows: [{ authorized: false }],
  });
  expect(input.observations.size).toBe(0);
  expect(
    accrualObserverQueryResponse({ ...input, sql: statements.apply })
  ).toEqual({ rows: [{ result: 'applied' }] });
  expect(
    accrualObserverQueryResponse({ ...input, sql: statements.apply })
  ).toEqual({ rows: [{ result: 'duplicate' }] });
  expect(input.observations.size).toBe(1);
  expect(input.paid.size).toBe(0);
});
