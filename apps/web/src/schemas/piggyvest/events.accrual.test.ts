import { describe, expect, it } from 'vitest';
import {
  interestAccruedSuccessRecordEventSchema,
  piggyvestWebhookEventSchema,
} from './events';

describe('interest-accrued.success', () => {
  it('routes the officially listed event through the union', () => {
    const eventType = 'interest-accrued.success';
    const event = {
      eventId: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
      customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
      eventType,
      eventCategory: 'unpublished-category',
      eventData: { provider_status: 'synthetic' },
    };
    expect(interestAccruedSuccessRecordEventSchema.parse(event).eventType).toBe(
      eventType
    );
    expect(piggyvestWebhookEventSchema.parse(event).eventType).toBe(eventType);
  });
});

describe('piggyvestWebhookEventSchema', () => {
  it('accepts a documented interest-accrued payload (including fields added later) as record-only', () => {
    const accrued = {
      eventId: '01K8TESTACCRUED001',
      customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
      eventType: 'interest-accrued.success',
      eventCategory: 'interest_accrued',
      eventData: {
        id: 'synthetic-accrual-001',
        wallet_id: '923f843a-be7e-494a-bc5d-9f49f4cc640f',
        amount: 12.5,
        interest_type: 'differential',
        differential_wallet_id: '2b7a1f1c-6d2f-4d6e-9f5e-0a1b2c3d4e5f',
      },
      pvb_wallet: '01K8TESTWALLET00000000001',
    };
    const parsed = piggyvestWebhookEventSchema.parse(accrued);
    expect(parsed.eventType).toBe('interest-accrued.success');
  });
});
