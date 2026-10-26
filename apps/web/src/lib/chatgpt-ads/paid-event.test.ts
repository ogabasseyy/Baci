import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ConversionEvent } from '@/lib/analytics/ad-platform-conversion-event';
import { buildChatgptPaidEvent } from './paid-event';

const event: ConversionEvent = {
  merchant_id: 'merchant-1',
  event_type: 'purchase',
  event_id: 'stable-order-1',
  occurred_at: '2026-10-24T10:00:00.000Z',
  source: 'server',
  user_data: {
    email: ' PERSON@Example.com ',
    oppref: 'original-click',
    obref: 'browser-ref',
    measurement_consent: true,
  },
  custom_data: {
    value: 12500.25,
    currency: 'NGN',
    order_id: 'order-1',
    contents: [{ id: 'sku', price: 12500.25, quantity: 1 }],
  },
};

describe('buildChatgptPaidEvent', () => {
  it('preserves durable identity and time and converts naira to integer kobo', () => {
    const result = buildChatgptPaidEvent(event, 'https://ogabassey.com');
    expect(result).toMatchObject({
      id: 'stable-order-1',
      type: 'order_created',
      timestamp_ms: 1792836000000,
      source_url: 'https://ogabassey.com',
      action_source: 'web',
      oppref: 'original-click',
      data: {
        type: 'contents',
        amount: 1250025,
        currency: 'NGN',
        contents: [{ amount: 1250025, quantity: 1 }],
      },
      user: {
        obref: 'browser-ref',
        emails_sha256: [
          createHash('sha256').update('person@example.com').digest('hex'),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('PERSON@Example.com');
  });
  it('does not send when measurement consent is absent or withdrawn', () => {
    expect(
      buildChatgptPaidEvent(
        { ...event, user_data: {} },
        'https://ogabassey.com'
      )
    ).toBeNull();
    expect(
      buildChatgptPaidEvent(
        { ...event, user_data: { measurement_consent: false } },
        'https://ogabassey.com'
      )
    ).toBeNull();
  });
  it('rejects untrusted client purchase observations', () => {
    expect(
      buildChatgptPaidEvent(
        { ...event, source: 'web' },
        'https://ogabassey.com'
      )
    ).toBeNull();
    expect(
      buildChatgptPaidEvent(
        { ...event, event_type: 'place_order' },
        'https://ogabassey.com'
      )
    ).toBeNull();
  });
  it('uses original timestamp on retries and supports zero-decimal currencies', () => {
    expect(
      buildChatgptPaidEvent(
        { ...event, custom_data: { value: 12500, currency: 'JPY' } },
        'https://shop.example.com'
      )?.data.amount
    ).toBe(12500);
    expect(
      buildChatgptPaidEvent(event, 'https://ogabassey.com')?.timestamp_ms
    ).toBe(Date.parse(event.occurred_at ?? ''));
  });
  it('rejects invalid amounts, currency, time and non-HTTPS origins', () => {
    expect(() =>
      buildChatgptPaidEvent(
        { ...event, custom_data: { value: -1, currency: 'NGN' } },
        'https://ogabassey.com'
      )
    ).toThrow('invalid_chatgpt_amount');
    expect(() =>
      buildChatgptPaidEvent(
        { ...event, custom_data: { value: 1, currency: 'ZZZ' } },
        'https://ogabassey.com'
      )
    ).toThrow('invalid_chatgpt_amount');
    expect(() =>
      buildChatgptPaidEvent(
        { ...event, occurred_at: undefined },
        'https://ogabassey.com'
      )
    ).toThrow('invalid_chatgpt_event_identity');
    expect(() => buildChatgptPaidEvent(event, 'http://evil.example')).toThrow(
      'invalid_chatgpt_source'
    );
  });
});
