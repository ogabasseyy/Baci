import { describe, expect, it } from 'vitest';
import {
  onboardingReminderQuerySchema,
  onboardingReminderResponseSchema,
  onboardingReminderSnoozeSchema,
} from './onboarding-reminder';

describe('onboarding reminder input contracts', () => {
  it('requires an explicit merchant and accepts only the fixed snooze action', () => {
    expect(onboardingReminderQuerySchema.safeParse({}).success).toBe(false);
    expect(
      onboardingReminderQuerySchema.safeParse({ merchantId: 'arbitrary' })
        .success
    ).toBe(false);
    expect(
      onboardingReminderSnoozeSchema.safeParse({ action: 'snooze' }).success
    ).toBe(true);
    expect(
      onboardingReminderSnoozeSchema.safeParse({
        action: 'snooze',
        user_id: 'other',
      }).success
    ).toBe(false);
  });
  it('rejects remote action URLs and accepts suppressed reminders', () => {
    const merchantId = '11111111-1111-4111-8111-111111111111';
    expect(
      onboardingReminderResponseSchema.safeParse({ merchantId, reminder: null })
        .success
    ).toBe(true);
    expect(
      onboardingReminderResponseSchema.safeParse({
        merchantId,
        reminder: {
          id: 'step',
          title: 'Setup',
          description: 'Finish',
          action: 'Go',
          href: 'https://example.com',
        },
      }).success
    ).toBe(false);
  });
});
