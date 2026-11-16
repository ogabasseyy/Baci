import { z } from 'zod';

export const quizAttestationChallengeResponseSchema = z.object({
  expiresAt: z.string(),
  nonce: z.string().min(1),
});
