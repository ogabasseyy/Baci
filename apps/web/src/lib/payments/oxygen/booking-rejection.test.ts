import { expect, it } from 'vitest';
import {
  OxygenActiveLoanPreflightError,
  oxygenActiveLoanCode,
  oxygenActiveLoanMessage,
} from './booking-rejection';

it('reports an existing loan with the public rejection code and saved-progress copy', () => {
  const error = new OxygenActiveLoanPreflightError();

  expect(error.code).toBe(oxygenActiveLoanCode);
  expect(error.message).toBe(oxygenActiveLoanMessage);
  expect(error.message).toContain('Your progress is saved');
});
