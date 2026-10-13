import { z } from 'zod';

const notificationDetailsSchema = z.object({
  action_label: z.string().nullable(),
  action_url: z.string().nullable(),
  channels: z.array(z.enum(['in_app', 'banner', 'push'])),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  id: z.uuid(),
  is_system: z.boolean(),
  message: z.string(),
  notification_type: z.enum(['info', 'success', 'warning', 'error']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  delivery_state: z
    .enum(['pending', 'processing', 'sent', 'expired', 'failed'])
    .optional(),
  sent_at: z.string().nullable().optional(),
  title: z.string(),
});

/** Validates the explicit recipient and embedded notification fields returned to merchants. */
export const merchantNotificationWithDetailsSchema = z.object({
  banner_dismissed_at: z.string().nullable(),
  created_at: z.string(),
  dismissed_at: z.string().nullable(),
  id: z.uuid(),
  in_app_visible: z.boolean().optional(),
  merchant_id: z.uuid(),
  notification: notificationDetailsSchema,
  notification_id: z.uuid(),
  read_at: z.string().nullable(),
});

export const merchantNotificationListResultSchema = z.array(
  merchantNotificationWithDetailsSchema
);
