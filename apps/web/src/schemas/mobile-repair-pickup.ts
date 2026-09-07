import { z } from 'zod';
import { repairBookingSchema } from '@/lib/validations/repair';
import { repairPickupExpectedFeeSchema } from '@/schemas/repair-actions';

export const mobileRepairPickupSchema = z
  .discriminatedUnion('action', [
    z.object({ action: z.literal('quote'), data: repairBookingSchema }),
    z.object({
      action: z.literal('pay'),
      data: repairBookingSchema,
      expectedPickupFee: repairPickupExpectedFeeSchema,
      resumeToken: z.string().min(1).max(4096).optional(),
    }),
  ])
  .refine((input) => input.data.serviceType === 'pickup', {
    message: 'Select courier pickup.',
  });
