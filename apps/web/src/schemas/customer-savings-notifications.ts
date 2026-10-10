import { z } from 'zod';

const uuidSchema = z.string().uuid();
const clockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timeZoneSchema = z
  .string()
  .min(1)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return true;
    } catch {
      return false;
    }
  });

export const customerSavingsNotificationPreferencesSchema = z
  .object({
    encouragementEnabled: z.boolean(),
    weeklySummaryEnabled: z.boolean(),
    interestAlertsEnabled: z.boolean(),
    quietHoursStart: clockTimeSchema,
    quietHoursEnd: clockTimeSchema,
    timeZone: timeZoneSchema,
  })
  .strict();

export const customerSavingsNotificationPreferenceUpdatesSchema = z
  .object({
    encouragementEnabled: z.boolean().optional(),
    weeklySummaryEnabled: z.boolean().optional(),
    interestAlertsEnabled: z.boolean().optional(),
    quietHoursStart: clockTimeSchema.optional(),
    quietHoursEnd: clockTimeSchema.optional(),
    timeZone: timeZoneSchema.optional(),
  })
  .strict()
  .refine((preferences) => Object.keys(preferences).length > 0);

export const customerSavingsNotificationsQuerySchema = z
  .object({
    merchantId: uuidSchema,
    merchantSlug: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export const customerSavingsNotificationsUpdateRequestSchema = z
  .object({
    merchantId: uuidSchema,
    preferences: customerSavingsNotificationPreferenceUpdatesSchema.optional(),
    readNotificationId: uuidSchema.optional(),
  })
  .strict()
  .refine(
    (request) =>
      (request.preferences !== undefined) !==
      (request.readNotificationId !== undefined)
  );

export const customerSavingsNotificationSchema = z
  .object({
    id: uuidSchema,
    goalId: uuidSchema.nullable(),
    type: z.enum([
      'interest_credited',
      'first_contribution',
      'milestone',
      'streak',
      'missed_contribution',
      'weekly_summary',
      'goal_completed',
    ]),
    title: z.string(),
    body: z.string(),
    createdAt: z.string().datetime({ offset: true }),
    readAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const customerSavingsNotificationsResponseSchema = z
  .object({
    notifications: z.array(customerSavingsNotificationSchema),
    preferences: customerSavingsNotificationPreferencesSchema,
  })
  .strict();

export const customerSavingsNotificationsApiResponseSchema =
  customerSavingsNotificationsResponseSchema.extend({
    deliveryEnabled: z.boolean(),
  });
