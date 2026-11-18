import { z } from 'zod';
import {
  type OxygenFollowUpStatus,
  oxygenFollowUpStatusSchema,
} from './oxygen-follow-up-status';

const candidateStatusSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .transform((status): OxygenFollowUpStatus => {
    const result = oxygenFollowUpStatusSchema.safeParse(status);
    return result.success ? result.data : 'needs_review';
  });

export const oxygenFollowUpCandidateSchema = z
  .object({
    order_id: z.uuid(),
    follow_up_status: candidateStatusSchema,
    last_activity_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export const oxygenFollowUpCandidatesSchema = z
  .array(oxygenFollowUpCandidateSchema)
  .max(250);
