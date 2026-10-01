import { describe, expect, it } from 'vitest';
import { notificationPreferencesPatchSchema } from './notification-preferences';

describe('notificationPreferencesPatchSchema', () => {
  it('accepts a valid quiet-hours time zone update', () => {
    expect(
      notificationPreferencesPatchSchema.safeParse({
        quiet_hours_time_zone: 'Africa/Lagos',
      }).success
    ).toBe(true);
  });

  it('accepts a follow-up alert toggle update', () => {
    expect(
      notificationPreferencesPatchSchema.safeParse({
        follow_up_notifications_enabled: false,
      }).success
    ).toBe(true);
  });

  it('rejects quiet hours when only one boundary is provided', () => {
    const result = notificationPreferencesPatchSchema.safeParse({
      quiet_hours_start: '22:00',
    });

    expect(result.success).toBe(false);
  });
});
