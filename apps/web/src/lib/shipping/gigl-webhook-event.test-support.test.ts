import { describe, expect, it } from 'vitest';
import { giglWebhookEventJson } from './gigl-webhook-event.test-support';

describe('giglWebhookEventJson', () => {
  it('builds a GIG-shaped event and applies overrides', () => {
    const event = JSON.parse(giglWebhookEventJson({ Waybill: '42' }));

    expect(event).toMatchObject({ Waybill: '42', StatusCode: 'MCRT' });
    expect(Object.keys(event)).toEqual([
      'Waybill',
      'SenderAddress',
      'ReceiverAddress',
      'Location',
      'Status',
      'UserId',
      'ChannelCode',
      'StatusCode',
    ]);
  });
});
