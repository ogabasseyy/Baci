import { z } from 'zod';

export const oxygenRepaymentReceiptsSchema = z.array(
  z.object({
    id: z.uuid(),
    recordedAt: z.iso.datetime({ offset: true }),
  })
);

export const oxygenOrderPlanSchema = z.object({
  upfront: z.number().finite().nonnegative().nullable(),
  upfrontConfirmed: z.boolean(),
  activationConfirmed: z.boolean().default(false),
  months: z.number().int().positive(),
  repaymentReceipts: oxygenRepaymentReceiptsSchema.optional(),
  schedule: z.array(
    z.object({
      period: z.number().int().positive(),
      dueDate: z.tuple([
        z.number().int(),
        z.number().int().min(1).max(12),
        z.number().int().min(1).max(31),
      ]),
      amount: z.number().finite().nonnegative(),
    })
  ),
});
export type OxygenOrderPlan = z.infer<typeof oxygenOrderPlanSchema>;

export const oxygenOrderPlanResponseSchema = z.object({
  plan: oxygenOrderPlanSchema.nullable(),
});

const paymentDateFormatter = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium',
  timeZone: 'Africa/Lagos',
});

export function formatOxygenRepaymentReceiptDate(recordedAt: string) {
  return paymentDateFormatter.format(new Date(recordedAt));
}

export function formatOxygenPaymentDate([
  year,
  month,
  day,
]: OxygenOrderPlan['schedule'][number]['dueDate']) {
  // Oxygen supplies a calendar date. UTC midnight stays on that date in Lagos.
  return paymentDateFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}
