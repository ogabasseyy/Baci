import { z } from 'zod';

export const replayArtifactInputSchema = z
  .object({
    receiverRoot: z.string().trim().min(1),
    savingsRoot: z.string().trim().min(1),
    outputDirectory: z.string().trim().min(1),
  })
  .strict();

export type ReplayArtifactInput = z.infer<typeof replayArtifactInputSchema>;
