import { describe, expect, it } from 'vitest';
import { redvaultApprovedCompletionSchema } from './redvault-approved-completion';

const completion = {
  actor: 'uba_redvault_verified_completion',
  already_completed: false,
  cancelled_at: null,
  order_already_paid: false,
  order_cancelled: false,
  order_number: 'ORDER-1',
  order_skipped_status: null,
  order_updated: true,
  payment_status: 'paid',
  previous_payment_status: 'unpaid',
  previous_shipping_status: 'pending',
  shipping_status: 'pending',
};
describe('REDVAULT approval receipt', () => {
  it.each([
    true,
    false,
  ])('accepts paid completion with duplicate=%s', (duplicate) => {
    expect(
      redvaultApprovedCompletionSchema.safeParse({
        kind: 'approved',
        duplicate,
        inventoryConfirmed: true,
        inventoryReclaimedUnitCount: 0,
        completion,
      }).success
    ).toBe(true);
  });
  it.each([
    { payment_status: 'unpaid' },
    { error_code: 'ORDER_NOT_FOUND' },
    { payment_status: null },
    { order_cancelled: true },
    { cancelled_at: '2026-09-12T09:00:00.000Z' },
  ])('rejects nonpaid or failed completion %j', (change) => {
    expect(
      redvaultApprovedCompletionSchema.safeParse({
        kind: 'approved',
        duplicate: false,
        inventoryConfirmed: true,
        inventoryReclaimedUnitCount: 0,
        completion: { ...completion, ...change },
      }).success
    ).toBe(false);
  });
  it.each([
    undefined,
    false,
    null,
  ])('rejects missing atomic inventory proof %s', (inventoryConfirmed) => {
    expect(
      redvaultApprovedCompletionSchema.safeParse({
        kind: 'approved',
        duplicate: false,
        completion,
        inventoryConfirmed,
        inventoryReclaimedUnitCount: 0,
      }).success
    ).toBe(false);
  });
});
