import { z } from 'zod';

export const savingsNotificationWorkerLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(50);

export const savingsNotificationExpoEndpointSchema = z
  .string()
  .url()
  .refine(
    (value) => value === 'https://exp.host/--/api/v2/push/send',
    'Only the official Expo push endpoint is allowed'
  );

export const savingsNotificationExpoReceiptsEndpointSchema = z
  .string()
  .url()
  .refine(
    (value) => value === 'https://exp.host/--/api/v2/push/getReceipts',
    'Only the official Expo receipts endpoint is allowed'
  );

const enabledSchema = z.enum(['true', 'false']).optional().default('false');

export const savingsNotificationWorkerConfigSchema = z
  .object({
    SAVINGS_NOTIFICATIONS_ENABLED: enabledSchema,
    SAVINGS_NOTIFICATIONS_DATABASE_URL: z.string().url().optional(),
    SAVINGS_NOTIFICATIONS_DATABASE_NAME: z.string().trim().min(1).optional(),
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  })
  .superRefine((config, context) => {
    if (config.SAVINGS_NOTIFICATIONS_ENABLED !== 'true') return;
    if (!config.SAVINGS_NOTIFICATIONS_DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['SAVINGS_NOTIFICATIONS_DATABASE_URL'],
        message:
          'Database URL is required when savings notifications are enabled',
      });
      return;
    }
    const protocol = new URL(config.SAVINGS_NOTIFICATIONS_DATABASE_URL)
      .protocol;
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
      context.addIssue({
        code: 'custom',
        path: ['SAVINGS_NOTIFICATIONS_DATABASE_URL'],
        message: 'A PostgreSQL connection URL is required',
      });
    }
    if (!config.SAVINGS_NOTIFICATIONS_DATABASE_NAME) {
      context.addIssue({
        code: 'custom',
        path: ['SAVINGS_NOTIFICATIONS_DATABASE_NAME'],
        message:
          'Database name is required when savings notifications are enabled',
      });
    }
  })
  .transform((config) => ({
    enabled: config.SAVINGS_NOTIFICATIONS_ENABLED === 'true',
    databaseUrl: config.SAVINGS_NOTIFICATIONS_DATABASE_URL,
    databaseName: config.SAVINGS_NOTIFICATIONS_DATABASE_NAME,
    expoAccessToken: config.EXPO_ACCESS_TOKEN,
  }));

export const claimedSavingsNotificationSchema = z.object({
  notification_id: z.string().uuid(),
  claim_id: z.string().uuid(),
  push_token: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  data: z
    .object({
      goalId: z.string().uuid(),
      merchantId: z.string().uuid(),
    })
    .passthrough(),
});

export const claimedSavingsNotificationsSchema = z.array(
  claimedSavingsNotificationSchema
);

export const pendingSavingsReceiptSchema = z.object({
  ticket_id: z.string().min(1).max(256),
  notification_id: z.string().uuid(),
  push_token: z.string().min(1),
});

export const pendingSavingsReceiptsSchema = z.array(
  pendingSavingsReceiptSchema
);

export type ClaimedSavingsNotification = z.infer<
  typeof claimedSavingsNotificationSchema
>;
