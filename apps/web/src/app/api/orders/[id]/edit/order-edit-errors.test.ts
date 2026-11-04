import { expect, it } from 'vitest';
import { mapOrderEditError } from './order-edit-errors';

it.each([
  [
    'oxygen_financial_edit_locked',
    'Financial edits are unavailable while Oxygen financing is in progress.',
  ],
  ['oxygen_order_edit_retry', 'The order is being updated. Please try again.'],
])('returns a distinct retry-safe response for %s', async (code, message) => {
  const response = mapOrderEditError({ message: code });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code, error: message });
});
