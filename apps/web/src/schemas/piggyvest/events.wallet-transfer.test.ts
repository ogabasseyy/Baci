import { describe, expect, it } from 'vitest';
import { withEnvelopeReference } from '@/lib/piggyvest/outflow-envelope-reference';
import { piggyvestWebhookEventSchema } from './events';

describe('bugfix: parsing dropped the envelope reference of a wallet transfer (Codex P2)', () => {
  it('keeps pvb_third_party_reference so the outflow is attributed', () => {
    const parsed = piggyvestWebhookEventSchema.parse({
      eventId: 'evt-1',
      eventType: 'wallet-transfer.outflow.success',
      eventCategory: 'wallet_transfer',
      customer_id: 'cus-1',
      eventData: { transaction_id: 'provider-1' },
      pvb_third_party_reference: 'pvb-pay-11111111-1111-4111-8111-111111111111',
    });
    expect(withEnvelopeReference(['provider-1'], parsed)).toEqual([
      'provider-1',
      'pvb-pay-11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('still accepts a delivery without it', () => {
    expect(
      piggyvestWebhookEventSchema.safeParse({
        eventId: 'evt-2',
        eventType: 'wallet-transfer.outflow.success',
        eventCategory: 'wallet_transfer',
        customer_id: 'cus-1',
        eventData: {},
      }).success
    ).toBe(true);
  });
});
