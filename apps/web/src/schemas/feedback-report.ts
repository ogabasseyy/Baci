import { z } from 'zod';

const optionalLabel = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

/** A free-text "Send feedback" report from the merchant admin apps. */
export const feedbackReportSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Tell us what happened')
    .max(4000, 'Keep feedback under 4000 characters'),
  screen: optionalLabel(200),
  appVersion: optionalLabel(40),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  device: optionalLabel(120),
});

export type FeedbackReportInput = z.infer<typeof feedbackReportSchema>;
