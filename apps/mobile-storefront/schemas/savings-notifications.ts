import { z } from 'zod';

const QuietHoursTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use HH:MM format');

const TimeZoneSchema = z.string().trim().min(1).max(100);
export const SavingsNotificationIdentifierSchema = z.uuid();

export const SavingsPushPayloadSchema = z.object({
  goalId: SavingsNotificationIdentifierSchema,
  merchantId: SavingsNotificationIdentifierSchema,
  notificationId: SavingsNotificationIdentifierSchema,
  type: z.literal('savings'),
});

export const SavingsNotificationPreferencesSchema = z.object({
  encouragementEnabled: z.boolean(),
  interestAlertsEnabled: z.boolean(),
  quietHoursEnd: QuietHoursTimeSchema,
  quietHoursStart: QuietHoursTimeSchema,
  timeZone: TimeZoneSchema,
  weeklySummaryEnabled: z.boolean(),
});

export const SavingsNotificationPreferencesPatchSchema =
  SavingsNotificationPreferencesSchema.partial().refine(
    (preferences) => Object.keys(preferences).length > 0,
    'At least one preference is required'
  );

export const SavingsNotificationSchema = z.object({
  body: z.string().trim().min(1).max(1_000),
  createdAt: z.iso.datetime({ offset: true }),
  goalId: SavingsNotificationIdentifierSchema,
  id: SavingsNotificationIdentifierSchema,
  readAt: z.iso.datetime({ offset: true }).nullable(),
  title: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(100),
});

export const SavingsNotificationInboxResponseSchema = z.object({
  deliveryEnabled: z.boolean().optional().default(false),
  notifications: z.array(SavingsNotificationSchema),
  preferences: SavingsNotificationPreferencesSchema,
});

export const SavingsNotificationMutationResponseSchema = z.object({
  success: z.literal(true),
});

export const SavingsNotificationMerchantInputSchema = z.object({
  merchantId: SavingsNotificationIdentifierSchema,
});

export type SavingsNotification = z.infer<typeof SavingsNotificationSchema>;
export type SavingsNotificationPreferences = z.infer<
  typeof SavingsNotificationPreferencesSchema
>;
export type SavingsNotificationPreferencesPatch = z.infer<
  typeof SavingsNotificationPreferencesPatchSchema
>;
