import { z } from 'zod';
import { MEDIA_DELETION_BATCH_SIZE } from '@/config/media-deletion';

export const mediaDeletionAdmissionSchema = z
  .array(
    z.object({
      path: z.string().min(1).max(1024),
      state: z.enum(['pending', 'deleted']),
      object_id: z.string().uuid(),
    })
  )
  .min(1)
  .max(MEDIA_DELETION_BATCH_SIZE);

export const mediaDeletionStatesSchema = z
  .array(z.object({ path: z.string(), state: z.enum(['pending', 'deleted']) }))
  .max(MEDIA_DELETION_BATCH_SIZE);
