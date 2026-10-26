import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { ConversionEvent } from '@/lib/analytics/ad-platform-conversion-event';
import { buildXPaidEvent } from './paid-event';

const event: ConversionEvent = {
  merchant_id: 'merchant-a',
  source: 'server',
  event_type: 'purchase',
  event_id: 'purchase_order-1',
  occurred_at: '2026-10-26T10:00:00Z',
  user_data: { marketing_consent: true, email: ' Shopper@Example.com ' },
  custom_data: {
    currency: 'NGN',
    value: 12500,
    contents: [{ id: 'catalog-a', quantity: 2, price: 6250 }],
  },
};
it('keeps the configured X event distinct from stable order dedup identity and hashes matching data', () => {
  const result = buildXPaidEvent(event, 'abc', 'tw-abc-paid');
  expect(result).toMatchObject({
    event_id: 'paid',
    conversion_id: 'purchase_order-1',
    conversion_time: '2026-10-26T10:00:00Z',
    price_currency: 'NGN',
    value: '12500',
    number_items: 2,
    contents: [{ content_id: 'catalog-a', num_items: 2, content_price: 6250 }],
  });
  expect(result?.identifiers).toEqual([
    {
      hashed_email: createHash('sha256')
        .update('shopper@example.com')
        .digest('hex'),
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('Shopper@');
});
it.each([
  undefined,
  false,
])('fails closed without affirmative marketing consent (%s)', (consent) => {
  expect(
    buildXPaidEvent(
      {
        ...event,
        user_data: { ...event.user_data, marketing_consent: consent },
      },
      'abc',
      'tw-abc-paid'
    )
  ).toBeNull();
});
it('rejects browser-supplied purchases and mismatched merchant event code', () => {
  expect(
    buildXPaidEvent({ ...event, source: 'web' }, 'abc', 'tw-abc-paid')
  ).toBeNull();
  expect(() => buildXPaidEvent(event, 'abc', 'tw-other-paid')).toThrow(
    'invalid_x_event_code'
  );
});
it('does not send a conversion without a usable customer matching identifier', () => {
  expect(
    buildXPaidEvent(
      { ...event, user_data: { marketing_consent: true } },
      'abc',
      'tw-abc-paid'
    )
  ).toBeNull();
});
it('rejects invalid monetary data', () => {
  expect(() =>
    buildXPaidEvent(
      { ...event, custom_data: { value: Number.NaN, currency: 'NGN' } },
      'abc',
      'tw-abc-paid'
    )
  ).toThrow();
});
