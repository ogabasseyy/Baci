import { z } from 'zod';

export const OXYGEN_REPAYMENT_HISTORY_LIMIT = 50;
// Match the Oxygen checkout booking action's maximum supported tenure.
const OXYGEN_ORDER_PLAN_MAX_MONTHS = 12;

export const oxygenRepaymentReceiptSchema = z.object({
  id: z.string().uuid(),
  recordedAt: z.string().datetime({ offset: true }),
});

export const oxygenRepaymentReceiptsSchema = z
  .array(oxygenRepaymentReceiptSchema)
  .max(OXYGEN_REPAYMENT_HISTORY_LIMIT);

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

const instalmentSchema = z.object({
  period: z.number().int().positive(),
  dueDate: paymentDateSchema,
  amount: z.number().finite().nonnegative(),
});

export const oxygenOrderPlanSchema = z.object({
  upfront: z.number().finite().nonnegative().nullable(),
  upfrontConfirmed: z.boolean(),
  activationConfirmed: z.boolean().default(false),
  months: z.number().int().positive().max(OXYGEN_ORDER_PLAN_MAX_MONTHS),
  repaymentReceipts: oxygenRepaymentReceiptsSchema.optional(),
  scheduleIncomplete: z.boolean().optional(),
  schedule: z
    .array(instalmentSchema)
    .max(OXYGEN_ORDER_PLAN_MAX_MONTHS)
    .refine(
      (rows) => new Set(rows.map(({ period }) => period)).size === rows.length,
      'Duplicate repayment period'
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
