import { z } from 'zod';
import { merchantIdParamSchema } from './merchant-id-param';

export const onboardingReminderQuerySchema = z.object({
  merchantId: merchantIdParamSchema,
});
export const onboardingReminderSnoozeSchema = z
  .object({
    action: z.literal('snooze'),
  })
  .strict();

export const onboardingReminderResponseSchema = z.object({
  merchantId: merchantIdParamSchema,
  reminder: z
    .object({
      id: z.string(),
      title: z.string(),
      action: z.string(),
      description: z.string(),
      href: z.string().startsWith('/dashboard'),
    })
    .nullable(),
});
