import { z } from 'zod';
import { oxygenProviderStateSchema } from './oxygen-runtime';
export const oxygenSavedPlanQuerySchema = z
  .object({ workflowId: z.uuid() })
  .strict();
export const oxygenSavedPlanSelectionSchema = oxygenSavedPlanQuerySchema
  .extend({ bookingReference: z.uuid() })
  .strict();
const state = oxygenProviderStateSchema.pick({
  bookingReference: true,
  booking: true,
  schedule: true,
  quotedCharges: true,
});
export const oxygenSavedPlanSchema = z
  .object({
    bookingReference: z.uuid(),
    productAmount: z.number().positive(),
    equityPercentage: z.number().min(25).max(90),
    tenure: z.number().int().min(1).max(12),
    state,
    updatedAt: z.string(),
  })
  .strict()
  .refine(
    (p) =>
      p.state.bookingReference === p.bookingReference &&
      p.state.booking?.loan_reference === p.bookingReference &&
      p.state.booking.product_amount === p.productAmount &&
      p.state.booking.equity_percentage === p.equityPercentage &&
      p.state.booking.loan_tenure === p.tenure &&
      p.state.booking.status === 'BOOKED' &&
      p.state.schedule?.length === p.tenure &&
      (p.state.booking.total_charges != null || p.state.quotedCharges != null),
    'Invalid saved plan'
  );
export const oxygenSavedPlansSchema = z
  .object({
    plans: z.array(oxygenSavedPlanSchema).max(200),
    selectedReference: z.uuid().nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.selectedReference === null ||
      v.plans.some((p) => p.bookingReference === v.selectedReference),
    'Unknown selected plan'
  );
export type OxygenSavedPlan = z.infer<typeof oxygenSavedPlanSchema>;
export type OxygenSavedPlans = z.infer<typeof oxygenSavedPlansSchema>;
