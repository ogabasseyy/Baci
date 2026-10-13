import { describe, expect, it } from 'vitest';
import {
  merchantNotificationListResultSchema,
  merchantNotificationWithDetailsSchema,
} from './merchant-notification-list-result';

const validResult = {
  banner_dismissed_at: null,
  created_at: '2026-08-05T10:00:00.000Z',
  dismissed_at: null,
  id: '123e4567-e89b-42d3-a456-426614174001',
  in_app_visible: true,
  merchant_id: '123e4567-e89b-42d3-a456-426614174002',
  notification: {
    action_label: null,
    action_url: null,
    channels: ['in_app'],
    created_at: '2026-08-05T10:00:00.000Z',
    expires_at: null,
    id: '123e4567-e89b-42d3-a456-426614174003',
    is_system: false,
    message: 'New stock is available.',
    notification_type: 'info',
    priority: 'normal',
    title: 'Inventory update',
  },
  notification_id: '123e4567-e89b-42d3-a456-426614174003',
  read_at: null,
} as const;

describe('merchantNotificationListResultSchema', () => {
  it('accepts the selected merchant-safe notification fields', () => {
    expect(
      merchantNotificationListResultSchema.safeParse([validResult]).success
    ).toBe(true);
  });

  it('accepts the detail-only delivery fields without requiring list visibility', () => {
    const { in_app_visible: _inAppVisible, ...detailResult } = {
      ...validResult,
      notification: {
        ...validResult.notification,
        delivery_state: 'sent' as const,
        sent_at: '2026-08-05T10:00:00.000Z',
      },
    };

    expect(
      merchantNotificationWithDetailsSchema.safeParse(detailResult).success
    ).toBe(true);
  });

  it.each([
    { notification: null },
    { in_app_visible: 'true' },
    { notification: { ...validResult.notification, channels: ['email'] } },
  ])('rejects malformed embedded notification rows: %o', (override) => {
    expect(
      merchantNotificationListResultSchema.safeParse([
        { ...validResult, ...override },
      ]).success
    ).toBe(false);
  });
});
