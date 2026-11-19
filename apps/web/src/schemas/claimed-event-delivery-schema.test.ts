import { describe, expect, it } from 'vitest';
import { claimedEventDeliverySchema } from './claimed-event-delivery-schema';

const delivery = {
  attempt_number: 1,
  claim_token: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a230',
  claimed_at: '2026-07-12T12:00:00.000Z',
  destination: 'facebook',
  domain_event_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
  id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a231',
  payload: {},
};

describe('claimedEventDeliverySchema', () => {
  it('accepts a strict claimed delivery', () => {
    expect(claimedEventDeliverySchema.safeParse(delivery).success).toBe(true);
  });

  it('rejects invalid destinations, UUIDs, and extra fields', () => {
    expect(
      claimedEventDeliverySchema.safeParse({
        ...delivery,
        destination: 'unsupported',
      }).success
    ).toBe(false);
    expect(
      claimedEventDeliverySchema.safeParse({ ...delivery, id: 'bad' }).success
    ).toBe(false);
    expect(
      claimedEventDeliverySchema.safeParse({ ...delivery, extra: true }).success
    ).toBe(false);
  });

  it('requires the payload property even when its value is unknown', () => {
    const withoutPayload: Partial<typeof delivery> = { ...delivery };
    delete withoutPayload.payload;

    expect(claimedEventDeliverySchema.safeParse(withoutPayload).success).toBe(
      false
    );
  });

  it('rejects a malformed claim timestamp', () => {
    expect(
      claimedEventDeliverySchema.safeParse({
        ...delivery,
        claimed_at: 'not-a-timestamp',
      }).success
    ).toBe(false);
  });
});
