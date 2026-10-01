import { z } from 'zod';
import { notificationActionUrl } from '@/lib/notification-action-url';
import {
  notificationTargetingSchema,
  notificationTargetMerchantIdsSchema,
} from './notification-targeting';

const dateTimeLocalSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    'Date and time must be a local datetime value'
  );

/**
 * datetime-local controls intentionally omit a timezone. Convert their local
 * wall-clock value at the browser boundary, then send only an explicit UTC ISO
 * timestamp to the API/DB.
 */
export function dateTimeLocalToUtcIso(value: string): string {
  const parsed = dateTimeLocalSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid local datetime');
  }

  const [datePart, timePart] = parsed.data.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes
  ) {
    throw new Error('Invalid local datetime');
  }
  return date.toISOString();
}

/**
 * Schema for single notification ID validation
 */
export const notificationIdSchema = z.uuid();

/** Recipient-side state changes intentionally expose only the three supported flags. */
export const updateMerchantNotificationSchema = z
  .strictObject({
    read: z.boolean().optional(),
    dismissed: z.literal(true).optional(),
    banner_dismissed: z.literal(true).optional(),
  })
  .refine(
    (data) =>
      data.read !== undefined ||
      data.dismissed !== undefined ||
      data.banner_dismissed !== undefined,
    { error: 'At least one notification state field is required' }
  );

const notificationActionUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => notificationActionUrl.parse(value) !== null, {
    error: 'Action URL must be an HTTPS URL or a same-site relative path',
  });

export const createNotificationSchema = z
  .strictObject({
    title: z.string().trim().min(1, { error: 'Title is required' }).max(200),
    message: z
      .string()
      .trim()
      .min(1, { error: 'Message is required' })
      .max(5000),
    notification_type: z
      .enum(['info', 'success', 'warning', 'error'])
      .optional()
      .default('info'),
    priority: z
      .enum(['low', 'normal', 'high', 'urgent'])
      .optional()
      .default('normal'),
    target_type: z
      .enum(['all', 'specific', 'segment'])
      .optional()
      .default('all'),
    target_merchant_ids: notificationTargetMerchantIdsSchema.optional(),
    target_segment: z.enum(['new', 'active', 'at_risk']).optional(),
    channels: z
      .array(z.enum(['in_app', 'banner', 'push']))
      .min(1, {
        error: 'At least one channel is required',
      })
      .superRefine((channels, ctx) => {
        if (new Set(channels).size !== channels.length) {
          ctx.addIssue({
            code: 'custom',
            message: 'Notification channels must be unique',
          });
        }
      }),
    action_url: notificationActionUrlSchema.optional().nullable(),
    action_label: z.string().trim().max(100).optional().nullable(),
    scheduled_for: z.iso.datetime().optional().nullable(),
    expires_at: z.iso.datetime().optional().nullable(),
    template_id: z.uuid().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.target_type === 'specific' && !data.target_merchant_ids?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Target merchant IDs required for specific targeting',
        path: ['target_merchant_ids'],
      });
    }
    if (data.target_type === 'segment' && !data.target_segment) {
      ctx.addIssue({
        code: 'custom',
        message: 'Target segment required for segment targeting',
        path: ['target_segment'],
      });
    }
    if (data.expires_at) {
      const expiresAt = new Date(data.expires_at).getTime();
      const effectiveSendAt = data.scheduled_for
        ? new Date(data.scheduled_for).getTime()
        : Date.now();
      if (expiresAt <= effectiveSendAt) {
        ctx.addIssue({
          code: 'custom',
          message: 'Expiration must be after the effective send time',
          path: ['expires_at'],
        });
      }
    }
  });

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

/**
 * Schema for PATCH updates: every field optional and NO defaults injected, so
 * partial updates only touch the fields the caller actually sent (a `.partial()`
 * of the create schema would re-apply defaults like notification_type='info').
 */
export const updateNotificationSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    message: z.string().trim().min(1).max(5000).optional(),
    notification_type: z
      .enum(['info', 'success', 'warning', 'error'])
      .optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    target_type: z.enum(['all', 'specific', 'segment']).optional(),
    target_merchant_ids: notificationTargetMerchantIdsSchema
      .optional()
      .nullable(),
    target_segment: z.enum(['new', 'active', 'at_risk']).optional(),
    channels: z
      .array(z.enum(['in_app', 'banner', 'push']))
      .min(1)
      .optional()
      .superRefine((channels, ctx) => {
        if (channels && new Set(channels).size !== channels.length) {
          ctx.addIssue({
            code: 'custom',
            message: 'Notification channels must be unique',
          });
        }
      }),
    action_url: notificationActionUrlSchema.optional().nullable(),
    action_label: z.string().trim().max(100).optional().nullable(),
    // A null PATCH would leave a pending notification without a scheduler
    // cursor. Editing the time is supported; cancelling is a separate action.
    scheduled_for: z.iso.datetime().optional(),
    expires_at: z.iso.datetime().optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    error: 'At least one notification field is required',
  });

export const mergedNotificationTargetingSchema = notificationTargetingSchema;

export const adminNotificationListQuerySchema = z.strictObject({
  status: z
    .enum([
      'all',
      'sent',
      'scheduled',
      'queued',
      'processing',
      'failed',
      'expired',
    ])
    .optional()
    .default('all'),
  type: z.enum(['info', 'success', 'warning', 'error']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).max(100_000).optional().default(0),
});

export const merchantNotificationListQuerySchema = z.strictObject({
  cursor: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  unread_only: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((value) => value === 'true'),
  type: z.enum(['info', 'success', 'warning', 'error']).optional(),
});

export const adminNotificationDetailRpcSchema = z.object({
  notification: z.object({
    id: z.uuid(),
    template_id: z.uuid().nullable(),
    title: z.string(),
    message: z.string(),
    notification_type: z.enum(['info', 'success', 'warning', 'error']),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    target_type: z.enum(['all', 'specific', 'segment']),
    target_merchant_ids: z.array(z.uuid()).nullable(),
    target_segment: z.enum(['new', 'active', 'at_risk']).nullable(),
    channels: z.array(z.enum(['in_app', 'banner', 'push'])),
    action_url: z.string().nullable(),
    action_label: z.string().nullable(),
    scheduled_for: z.string().nullable(),
    expires_at: z.string().nullable(),
    created_by: z.uuid(),
    created_at: z.string(),
    delivery_attempts: z.coerce.number().int().nonnegative(),
    delivery_last_error: z.string().nullable(),
    delivery_state: z.enum([
      'pending',
      'processing',
      'sent',
      'expired',
      'failed',
    ]),
    sent_at: z.string().nullable(),
    is_system: z.boolean(),
  }),
  stats: z.object({
    total_sent: z.coerce.number(),
    total_push_sent: z.coerce.number().default(0),
    total_read: z.coerce.number(),
    total_dismissed: z.coerce.number(),
    read_rate: z.coerce.number(),
  }),
  deliveries: z.array(
    z.object({
      id: z.uuid(),
      merchant_id: z.uuid(),
      business_name: z.string(),
      created_at: z.string(),
      read_at: z.string().nullable(),
      dismissed_at: z.string().nullable(),
    })
  ),
});

export const adminNotificationDashboardRpcSchema = z.object({
  totalSent: z.coerce.number(),
  avgReadRate: z.coerce.number(),
  activeBanners: z.coerce.number(),
  deliveryExpired: z.coerce.number().int().nonnegative(),
  deliveryFailed: z.coerce.number().int().nonnegative(),
  deliveryPending: z.coerce.number().int().nonnegative(),
  deliveryProcessing: z.coerce.number().int().nonnegative(),
  scheduled: z.coerce.number(),
});
