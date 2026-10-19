import { describe, expect, it } from '@jest/globals';
import {
  SavingsNotificationInboxResponseSchema,
  SavingsNotificationPreferencesPatchSchema,
  SavingsPushPayloadSchema,
} from './savings-notifications';

const preferences = {
  encouragementEnabled: true,
  interestAlertsEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  timeZone: 'Africa/Lagos',
  weeklySummaryEnabled: false,
};

describe('savings notification contracts', () => {
  it('defaults old-server delivery capability to false', () => {
    expect(
      SavingsNotificationInboxResponseSchema.parse({
        notifications: [],
        preferences,
      }).deliveryEnabled
    ).toBe(false);
  });

  it('rejects invalid quiet hours and empty preference patches', () => {
    expect(
      SavingsNotificationPreferencesPatchSchema.safeParse({}).success
    ).toBe(false);
    expect(
      SavingsNotificationPreferencesPatchSchema.safeParse({
        quietHoursStart: '24:00',
      }).success
    ).toBe(false);
    expect(
      SavingsNotificationPreferencesPatchSchema.safeParse({
        quietHoursEnd: '08:61',
      }).success
    ).toBe(false);
    expect(
      SavingsNotificationPreferencesPatchSchema.safeParse({
        interestAlertsEnabled: false,
      }).success
    ).toBe(true);
  });

  it('requires scoped, valid savings push identities', () => {
    const payload = {
      goalId: '00000000-0000-4000-8000-000000000001',
      merchantId: '00000000-0000-4000-8000-000000000002',
      notificationId: '00000000-0000-4000-8000-000000000003',
      type: 'savings',
    };
    expect(SavingsPushPayloadSchema.safeParse(payload).success).toBe(true);
    expect(
      SavingsPushPayloadSchema.safeParse({ ...payload, merchantId: '../other' })
        .success
    ).toBe(false);
    expect(
      SavingsPushPayloadSchema.safeParse({ ...payload, type: 'order' }).success
    ).toBe(false);
  });

  it('rejects malformed notification timestamps', () => {
    expect(
      SavingsNotificationInboxResponseSchema.safeParse({
        preferences,
        notifications: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            goalId: '00000000-0000-4000-8000-000000000002',
            type: 'milestone',
            title: 'Progress',
            body: 'Halfway',
            createdAt: 'yesterday',
            readAt: null,
          },
        ],
      }).success
    ).toBe(false);
  });
});
