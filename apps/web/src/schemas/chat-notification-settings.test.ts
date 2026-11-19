import { describe, expect, it } from 'vitest';
import {
  chatNotificationSettingsPatchSchema,
  chatNotificationSettingsSchema,
} from './chat-notification-settings';

describe('chatNotificationSettingsPatchSchema', () => {
  it.each([true, false])('accepts push_enabled=%s', (push_enabled) => {
    expect(
      chatNotificationSettingsPatchSchema.safeParse({ push_enabled }).success
    ).toBe(true);
  });

  it.each([
    ['empty body', {}],
    ['string instead of boolean', { push_enabled: 'false' }],
    ['null', { push_enabled: null }],
    ['unknown extra key', { push_enabled: true, merchant_id: 'x' }],
  ])('rejects %s', (_label, body) => {
    expect(chatNotificationSettingsPatchSchema.safeParse(body).success).toBe(
      false
    );
  });
});

describe('chatNotificationSettingsSchema', () => {
  it('parses the response shape and rejects a missing switch', () => {
    expect(
      chatNotificationSettingsSchema.safeParse({ push_enabled: false }).success
    ).toBe(true);
    expect(chatNotificationSettingsSchema.safeParse({}).success).toBe(false);
  });
});
