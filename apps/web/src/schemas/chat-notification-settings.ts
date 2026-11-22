import { z } from 'zod';

/** Body of PATCH /api/merchant/chat-notifications. */
export const chatNotificationSettingsPatchSchema = z.strictObject({
  push_enabled: z.boolean(),
});

/** Response of GET and PATCH: only the one switch the merchant can change. */
export const chatNotificationSettingsSchema = z.strictObject({
  push_enabled: z.boolean(),
});

export type ChatNotificationSettings = z.infer<
  typeof chatNotificationSettingsSchema
>;
