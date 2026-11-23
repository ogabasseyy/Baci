import { expect, it } from 'vitest';
import { isCapturedPaymentFinalizationOutcome } from './captured-payment-finalization-outcomes';

it('recognizes incomplete finalization without confusing it with success or cancellation', () => {
  expect(isCapturedPaymentFinalizationOutcome('inventory_failed')).toBe(true);
  expect(isCapturedPaymentFinalizationOutcome('order_fetch_failed')).toBe(true);
  expect(isCapturedPaymentFinalizationOutcome('completed')).toBe(false);
  expect(isCapturedPaymentFinalizationOutcome('order_cancelled')).toBe(false);
  expect(isCapturedPaymentFinalizationOutcome(null)).toBe(false);
});
