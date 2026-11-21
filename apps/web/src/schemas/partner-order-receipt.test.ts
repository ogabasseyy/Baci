import { expect, it } from 'vitest';
import { partnerOrderReceiptSchema } from './partner-order-receipt';

it('omits private submission data from the public receipt', () => {
  const receipt = {
    submission_id: '20000000-0000-4000-8000-000000000002',
    partner_order_id: 'external-reference-1',
    received_at: '2026-11-20T15:00:00+00:00',
    status: 'pending_verification',
  };
  expect(
    partnerOrderReceiptSchema.parse({ ...receipt, submission: { payment: {} } })
  ).toEqual(receipt);
});

it('requires an order ID before reporting acceptance', () => {
  const accepted = {
    submission_id: '20000000-0000-4000-8000-000000000002',
    partner_order_id: 'external-reference-1',
    received_at: '2026-11-20T15:00:00+00:00',
    status: 'accepted',
  };
  expect(partnerOrderReceiptSchema.safeParse(accepted).success).toBe(false);
  expect(
    partnerOrderReceiptSchema.parse({
      ...accepted,
      order_id: '20000000-0000-4000-8000-000000000003',
    })
  ).toMatchObject(accepted);
});
