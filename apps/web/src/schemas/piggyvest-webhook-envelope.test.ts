import { describe, expect, it } from 'vitest';
import { piggyvestWebhookEnvelopeSchema } from './piggyvest-webhook-envelope';

const envelope = {
  eventId: 'synthetic-event',
  customer_id: 'synthetic-customer',
  eventType: 'synthetic.unsupported',
  eventCategory: 'synthetic',
  eventData: {},
};

describe('piggyvestWebhookEnvelopeSchema', () => {
  it('accepts the documented envelope without assuming financial event details', () => {
    expect(piggyvestWebhookEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it.each([
    'eventId',
    'customer_id',
    'eventType',
    'eventCategory',
    'eventData',
  ])('requires %s', (field) => {
    expect(
      piggyvestWebhookEnvelopeSchema.safeParse({
        ...envelope,
        [field]: undefined,
      }).success
    ).toBe(false);
  });

  it.each([
    '',
    'x'.repeat(513),
  ])('rejects invalid event identity length', (eventId) => {
    expect(
      piggyvestWebhookEnvelopeSchema.safeParse({ ...envelope, eventId }).success
    ).toBe(false);
  });

  it('does not project body-provided tenant identity', () => {
    expect(
      piggyvestWebhookEnvelopeSchema.parse({
        ...envelope,
        merchantId: 'untrusted',
      })
    ).toEqual(envelope);
  });
});
