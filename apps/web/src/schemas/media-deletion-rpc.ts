import { z } from 'zod';

export const mediaDeletionAdmissionSchema = z
  .array(
    z.object({
      path: z.string().min(1).max(1024),
      state: z.enum(['pending', 'deleted']),
      object_id: z.string().uuid(),
    })
  )
  .min(1)
  .max(100);

export const mediaDeletionStatesSchema = z
  .array(z.object({ path: z.string(), state: z.enum(['pending', 'deleted']) }))
  .max(100);
