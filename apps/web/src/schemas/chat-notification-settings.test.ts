import { describe, expect, it } from 'vitest';
import {
  CHAT_ALERT_LEVELS,
  chatAlertLevelSchema,
  chatNotificationSettingsPatchSchema,
  chatNotificationSettingsSchema,
} from './chat-notification-settings';

describe('chatAlertLevelSchema', () => {
  it('knows exactly the three levels the database stores', () => {
    expect([...CHAT_ALERT_LEVELS]).toEqual(['all', 'handover', 'off']);
    for (const level of CHAT_ALERT_LEVELS) {
      expect(chatAlertLevelSchema.safeParse(level).success).toBe(true);
    }
    expect(chatAlertLevelSchema.safeParse('sometimes').success).toBe(false);
  });
});

describe('chatNotificationSettingsPatchSchema', () => {
  it.each(CHAT_ALERT_LEVELS)('accepts level=%s', (level) => {
    expect(
      chatNotificationSettingsPatchSchema.safeParse({ level }).success
    ).toBe(true);
  });

  it.each([
    ['empty body', {}],
    ['unknown level', { level: 'sometimes' }],
    ['upper-case level', { level: 'ALL' }],
    ['boolean instead of a level', { level: true }],
    ['null', { level: null }],
    ['the old push switch', { push_enabled: true }],
    ['unknown extra key', { level: 'all', merchant_id: 'x' }],
  ])('rejects %s', (_label, body) => {
    expect(chatNotificationSettingsPatchSchema.safeParse(body).success).toBe(
      false
    );
  });
});

describe('chatNotificationSettingsSchema', () => {
  it('parses the response shape and rejects a missing or unknown level', () => {
    expect(
      chatNotificationSettingsSchema.safeParse({ level: 'handover' }).success
    ).toBe(true);
    expect(chatNotificationSettingsSchema.safeParse({}).success).toBe(false);
    expect(
      chatNotificationSettingsSchema.safeParse({ level: 'x' }).success
    ).toBe(false);
  });
});
