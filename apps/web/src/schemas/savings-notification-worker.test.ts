import { describe, expect, it } from 'vitest';
import {
  savingsNotificationExpoEndpointSchema,
  savingsNotificationExpoReceiptsEndpointSchema,
  savingsNotificationWorkerConfigSchema,
  savingsNotificationWorkerLimitSchema,
} from './savings-notification-worker';

describe('savings notification worker schemas', () => {
  it('accepts a configured worker with the exact Expo endpoint', () => {
    expect(
      savingsNotificationWorkerConfigSchema.parse({
        SAVINGS_NOTIFICATIONS_ENABLED: 'true',
        SAVINGS_NOTIFICATIONS_DATABASE_URL:
          'postgresql://worker:secret@db.test/app',
        SAVINGS_NOTIFICATIONS_DATABASE_NAME: 'app',
        EXPO_ACCESS_TOKEN: 'expo-secret',
      })
    ).toMatchObject({ enabled: true, databaseName: 'app' });
  });

  it('keeps the worker disabled without requiring database credentials', () => {
    expect(
      savingsNotificationWorkerConfigSchema.parse({
        SAVINGS_NOTIFICATIONS_ENABLED: 'false',
      })
    ).toMatchObject({ enabled: false });
  });

  it('rejects enabled configuration without its isolated database identity', () => {
    expect(
      savingsNotificationWorkerConfigSchema.safeParse({
        SAVINGS_NOTIFICATIONS_ENABLED: 'true',
        SAVINGS_NOTIFICATIONS_DATABASE_URL:
          'postgresql://worker:secret@db.test/app',
        SAVINGS_NOTIFICATIONS_DATABASE_NAME: ' ',
      }).success
    ).toBe(false);
  });

  it('limits claim batches to integers from one through one hundred', () => {
    expect(savingsNotificationWorkerLimitSchema.parse('100')).toBe(100);
    expect(savingsNotificationWorkerLimitSchema.safeParse('101').success).toBe(
      false
    );
    expect(savingsNotificationWorkerLimitSchema.safeParse('1.5').success).toBe(
      false
    );
  });

  it('rejects every Expo endpoint except the fixed HTTPS push URL', () => {
    expect(
      savingsNotificationExpoEndpointSchema.safeParse(
        'http://exp.host/--/api/v2/push/send'
      ).success
    ).toBe(false);
    expect(
      savingsNotificationExpoEndpointSchema.safeParse(
        'https://attacker.test/--/api/v2/push/send'
      ).success
    ).toBe(false);
    expect(
      savingsNotificationExpoReceiptsEndpointSchema.safeParse(
        'https://exp.host/--/api/v2/push/getReceipts'
      ).success
    ).toBe(true);
    expect(
      savingsNotificationExpoReceiptsEndpointSchema.safeParse(
        'https://exp.host/--/api/v2/push/send'
      ).success
    ).toBe(false);
  });
});
