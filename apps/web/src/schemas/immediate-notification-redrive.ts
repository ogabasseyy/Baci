import { z } from 'zod';

export const immediateNotificationRecoveryBatchSize = z
  .number()
  .int()
  .min(1)
  .max(100);
export const immediateNotificationRecoveryBatchQuery = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(immediateNotificationRecoveryBatchSize);
export const immediateNotificationRecoveryCandidates = z
  .array(
    z.object({
      order_id: z.string().uuid(),
      claim_token: z.string().uuid(),
      status: z.enum(['accepted', 'unknown', 'dispatching']),
    })
  )
  .max(100);
