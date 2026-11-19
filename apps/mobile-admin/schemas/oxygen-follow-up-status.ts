import { z } from 'zod';

export const oxygenFollowUpStatusSchema = z.enum([
  'customer_action',
  'oxygen_processing',
  'approved_pending',
  'needs_review',
]);
export type OxygenFollowUpStatus = z.infer<typeof oxygenFollowUpStatusSchema>;
