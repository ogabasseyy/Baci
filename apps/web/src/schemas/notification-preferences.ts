import { z } from 'zod';

const timeStringSchema = z
  .string()
  .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)')
  .nullable();

const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA time zone');

export const notificationPreferencesPatchSchema = z
  .strictObject({
    in_app_enabled: z.boolean().optional(),
    banner_enabled: z.boolean().optional(),
    follow_up_notifications_enabled: z.boolean().optional(),
    quiet_hours_start: timeStringSchema.optional(),
    quiet_hours_end: timeStringSchema.optional(),
    quiet_hours_time_zone: timeZoneSchema.optional(),
  })
  .refine(
    (data) => {
      const hasStart =
        data.quiet_hours_start !== null && data.quiet_hours_start !== undefined;
      const hasEnd =
        data.quiet_hours_end !== null && data.quiet_hours_end !== undefined;
      return hasStart === hasEnd;
    },
    {
      message: 'Both quiet hours start and end must be set together',
      path: ['quiet_hours_start'],
    }
  )
  .refine(
    (data) =>
      data.in_app_enabled !== undefined ||
      data.banner_enabled !== undefined ||
      data.follow_up_notifications_enabled !== undefined ||
      data.quiet_hours_start !== undefined ||
      data.quiet_hours_end !== undefined ||
      data.quiet_hours_time_zone !== undefined,
    { message: 'At least one preference must be updated' }
  );

export type NotificationPreferencesPatch = z.infer<
  typeof notificationPreferencesPatchSchema
>;
