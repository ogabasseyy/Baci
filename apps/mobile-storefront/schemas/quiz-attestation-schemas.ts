import { z } from 'zod';

export const quizAttestationChallengeResponseSchema = z.object({
  expiresAt: z.string(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
