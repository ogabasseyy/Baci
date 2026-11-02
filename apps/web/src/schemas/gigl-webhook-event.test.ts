import { describe, expect, it } from 'vitest';
import { giglWebhookEventSchema } from './gigl-webhook-event';

const event = {
  Waybill: '1349104478',
  SenderAddress: '2d1 Sample Street, Lagos',
  ReceiverAddress: '39 Sample Road, Lagos',
  Location: null,
  Status: 'SHIPMENT CREATED BY CUSTOMER',
  UserId: '949c9c99-5dd7-4db1-8980-1cbb3fa8fc99',
  ChannelCode: 'IND298636',
  StatusCode: 'MCRT',
};

describe('giglWebhookEventSchema', () => {
  it("parses GIG's documented event and strips both addresses", () => {
    const parsed = giglWebhookEventSchema.parse(event);

    expect(parsed).toEqual({
      Waybill: '1349104478',
      Location: null,
      Status: 'SHIPMENT CREATED BY CUSTOMER',
      UserId: '949c9c99-5dd7-4db1-8980-1cbb3fa8fc99',
      ChannelCode: 'IND298636',
      StatusCode: 'MCRT',
    });
  });

  it('normalizes numeric and padded waybills to trimmed strings', () => {
    expect(
      giglWebhookEventSchema.parse({ ...event, Waybill: 1349104478 })
    ).toMatchObject({ Waybill: '1349104478' });
    expect(
      giglWebhookEventSchema.parse({ ...event, Waybill: ' INT-1349104478 ' })
    ).toMatchObject({ Waybill: 'INT-1349104478' });
  });

  it('accepts events without optional status fields', () => {
    const { Status, StatusCode, Location, ...required } = event;

    expect(giglWebhookEventSchema.safeParse(required).success).toBe(true);
  });

  it.each([
    ['an empty waybill', { Waybill: '' }],
    ['a waybill with spaces', { Waybill: '1349 104478' }],
    ['a waybill starting with a dash', { Waybill: '-1349104478' }],
    ['an over-long waybill', { Waybill: 'A'.repeat(65) }],
    ['a blank user id', { UserId: '   ' }],
    ['a missing channel code', { ChannelCode: undefined }],
  ])('rejects %s', (_label, overrides) => {
    expect(
      giglWebhookEventSchema.safeParse({ ...event, ...overrides }).success
    ).toBe(false);
  });
});

describe('giglWebhookEventSchema informational fields', () => {
  it('nulls odd informational fields instead of rejecting the delivery', () => {
    expect(
      giglWebhookEventSchema.parse({
        ...event,
        Location: 'L'.repeat(513),
        Status: 42,
        StatusCode: 'X'.repeat(33),
      })
    ).toMatchObject({
      Waybill: '1349104478',
      Location: null,
      Status: null,
      StatusCode: null,
    });
  });
});
