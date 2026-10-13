import { expect, it } from 'vitest';
import { prefundedCardOperationInputSchemas as schemas } from './prefunded-card-operation-store';

it('requires a bounded lease and explicit final verification outcome', () => {
  for (const value of [null, 0, 301, '60'])
    expect(schemas.leaseSeconds.safeParse(value).success).toBe(false);
  expect(schemas.leaseSeconds.parse(60)).toBe(60);
  expect(schemas.reconciliationOutcome.safeParse('pending').success).toBe(
    false
  );
  expect(schemas.reconciliationOutcome.parse('verified_success')).toBe(
    'verified_success'
  );
});
