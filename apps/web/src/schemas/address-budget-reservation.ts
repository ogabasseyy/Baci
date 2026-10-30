import { z } from 'zod';

export const addressBudgetReservationSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('reserved'),
    reservationId: z.uuid(),
    dispatchBefore: z.number().int().positive().safe(),
  }),
  z.object({
    status: z.literal('paced'),
    retryAfterMs: z.number().int().min(1).max(250),
  }),
  z.object({ status: z.enum(['unavailable', 'limit_reached', 'duplicate']) }),
]);
export type AddressBudgetReservation = z.infer<
  typeof addressBudgetReservationSchema
>;
