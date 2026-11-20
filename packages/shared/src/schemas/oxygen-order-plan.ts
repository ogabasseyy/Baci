import { z } from 'zod';

export const oxygenRepaymentReceiptsSchema = z.array(
  z.object({
    id: z.uuid(),
    recordedAt: z.iso.datetime({ offset: true }),
  })
);

function utcCalendarDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

const paymentDateSchema = z
  .tuple([
    z.number().int().min(1).max(9999),
    z.number().int().min(1).max(12),
    z.number().int().min(1).max(31),
  ])
  .refine(([year, month, day]) => {
    const date = utcCalendarDate(year, month, day);
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Invalid payment date');

export const oxygenOrderPlanSchema = z.object({
  upfront: z.number().finite().nonnegative().nullable(),
  upfrontConfirmed: z.boolean(),
  activationConfirmed: z.boolean().default(false),
  months: z.number().int().positive(),
  repaymentReceipts: oxygenRepaymentReceiptsSchema.optional(),
  schedule: z.array(
    z.object({
      period: z.number().int().positive(),
      dueDate: paymentDateSchema,
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
  return paymentDateFormatter.format(utcCalendarDate(year, month, day));
}
