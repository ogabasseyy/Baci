import { expect, it } from 'vitest';
import { PartialCancellationRefundError } from './partial-cancellation-refund-error';

it('carries accepted refund IDs when a later leg could not be verified', () => {
  const error = new PartialCancellationRefundError([42, 43]);
  expect(error).toBeInstanceOf(Error);
  expect(error.refundIds).toEqual([42, 43]);
});
