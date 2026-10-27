import { expect, it } from 'vitest';
import { buildAnalyticsEventData } from './build-analytics-event-data';
import { conversionEventPayload } from './conversion-event-payload';

it('keeps internal telemetry but excludes TikTok/Snap without explicit marketing consent', () => {
  expect(
    buildAnalyticsEventData(
      { event_type: 'product_view', merchant_id: 'merchant' },
      'product_view'
    ).targets
  ).toEqual([]);
  expect(
    buildAnalyticsEventData(
      {
        event_type: 'product_view',
        merchant_id: 'merchant',
        marketing_consent: true,
      },
      'product_view'
    ).targets
  ).toEqual(['tiktok', 'snapchat']);
});
it('does not restore excluded destinations when filtering an explicit conversion target list', () => {
  expect(
    conversionEventPayload.toStoredEventData({
      custom_data: {},
      event_name: 'ViewContent',
      event_source: 'web',
      event_time: 100,
      targets: ['snapchat'],
      user_data: {},
    }).targets
  ).toEqual([]);
  expect(
    conversionEventPayload.toStoredEventData({
      custom_data: {},
      event_name: 'ViewContent',
      event_source: 'web',
      event_time: 100,
      targets: ['snapchat'],
      marketing_consent: true,
      user_data: {},
    }).targets
  ).toEqual(['snapchat']);
});
