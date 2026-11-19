import { expect, it } from 'vitest';
import { oxygenFollowUpStatusSchema } from './oxygen-follow-up-status';

it('allows only the four customer-safe queue statuses', () => {
  expect(oxygenFollowUpStatusSchema.options).toEqual([
    'customer_action',
    'oxygen_processing',
    'approved_pending',
    'needs_review',
  ]);
  expect(oxygenFollowUpStatusSchema.safeParse('unexpected').success).toBe(
    false
  );
});
