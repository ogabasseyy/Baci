import { z } from 'zod';

export const prefundedCardReplayReadinessSchema = z
  .array(z.strictObject({ result: z.literal(true) }))
  .length(1);
