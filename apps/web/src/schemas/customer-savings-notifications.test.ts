import { describe, expect, it } from 'vitest';
import {
  customerSavingsNotificationPreferencesSchema,
  customerSavingsNotificationsApiResponseSchema,
  customerSavingsNotificationsResponseSchema,
  customerSavingsNotificationsUpdateRequestSchema,
} from './customer-savings-notifications';

const preferences = {
  encouragementEnabled: true,
  weeklySummaryEnabled: false,
  interestAlertsEnabled: true,
  quietHoursStart: '22:30',
  quietHoursEnd: '07:00',
  timeZone: 'Africa/Lagos',
};

describe('customer savings notification schemas', () => {
  it('accepts valid preferences and rejects invalid clock and IANA zone values', () => {
    expect(
      customerSavingsNotificationPreferencesSchema.safeParse(preferences)
        .success
    ).toBe(true);
    expect(
      customerSavingsNotificationPreferencesSchema.safeParse({
        ...preferences,
        quietHoursStart: '24:00',
      }).success
    ).toBe(false);
    expect(
      customerSavingsNotificationPreferencesSchema.safeParse({
        ...preferences,
        timeZone: 'Not/A_Time_Zone',
      }).success
    ).toBe(false);
  });

  it('requires exactly one nonempty preference or read action and rejects extra fields', () => {
    expect(
      customerSavingsNotificationsUpdateRequestSchema.safeParse({
        merchantId: '10000000-0000-4000-8000-000000000001',
        preferences: { weeklySummaryEnabled: true },
      }).success
    ).toBe(true);
    expect(
      customerSavingsNotificationsUpdateRequestSchema.safeParse({
        merchantId: '10000000-0000-4000-8000-000000000001',
        preferences: {},
      }).success
    ).toBe(false);
    expect(
      customerSavingsNotificationsUpdateRequestSchema.safeParse({
        merchantId: '10000000-0000-4000-8000-000000000001',
        readNotificationId: '20000000-0000-4000-8000-000000000001',
        preferences: { weeklySummaryEnabled: true },
      }).success
    ).toBe(false);
    expect(
      customerSavingsNotificationsUpdateRequestSchema.safeParse({
        merchantId: '10000000-0000-4000-8000-000000000001',
        readNotificationId: '20000000-0000-4000-8000-000000000001',
        unexpected: true,
      }).success
    ).toBe(false);
  });

  it('validates notification RPC payloads including allowed types and ISO timestamps', () => {
    const payload = {
      notifications: [
        {
          id: '20000000-0000-4000-8000-000000000001',
          goalId: null,
          type: 'weekly_summary',
          title: 'Your week',
          body: 'A steady week.',
          createdAt: '2026-09-25T12:00:00Z',
          readAt: null,
        },
      ],
      preferences,
    };
    expect(
      customerSavingsNotificationsResponseSchema.safeParse(payload).success
    ).toBe(true);
    expect(
      customerSavingsNotificationsResponseSchema.safeParse({
        ...payload,
        notifications: [{ ...payload.notifications[0], type: 'unknown' }],
      }).success
    ).toBe(false);
    expect(
      customerSavingsNotificationsApiResponseSchema.safeParse({
        ...payload,
        deliveryEnabled: true,
      }).success
    ).toBe(true);
    expect(
      customerSavingsNotificationsApiResponseSchema.safeParse(payload).success
    ).toBe(false);
  });
});
