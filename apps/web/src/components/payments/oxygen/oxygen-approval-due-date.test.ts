import { expect, it } from 'vitest';
import { oxygenApprovalDueDate } from './oxygen-approval-due-date';

it('formats the scheduled date in UTC and leaves missing schedules blank', () => {
  expect(oxygenApprovalDueDate([2026, 11, 27])).toBe('27 November 2026');
  expect(oxygenApprovalDueDate()).toBeUndefined();
});
