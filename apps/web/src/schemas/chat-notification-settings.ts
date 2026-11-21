import { z } from 'zod';

/**
 * What customer-chat alerts tell the merchant about: every new customer
 * message, only a chat the assistant hands to a person, or nothing.
 */
export const CHAT_ALERT_LEVELS = ['all', 'handover', 'off'] as const;

export const chatAlertLevelSchema = z.enum(CHAT_ALERT_LEVELS);

export type ChatAlertLevel = z.infer<typeof chatAlertLevelSchema>;

/** Body of PATCH /api/merchant/chat-notifications. */
export const chatNotificationSettingsPatchSchema = z.strictObject({
  level: chatAlertLevelSchema,
});

/** Response of GET and PATCH: the one choice the merchant can change. */
export const chatNotificationSettingsSchema = z.strictObject({
  level: chatAlertLevelSchema,
});

export type ChatNotificationSettings = z.infer<
  typeof chatNotificationSettingsSchema
>;
