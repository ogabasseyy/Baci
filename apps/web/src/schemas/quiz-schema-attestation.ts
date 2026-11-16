import { z } from 'zod';

export const quizAttestationChallengeRequestSchema = z
  .object({ eventId: z.string().uuid() })
  .strict();

export const quizAttestationChallengeResponseSchema = z.object({
  expiresAt: z.string(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
