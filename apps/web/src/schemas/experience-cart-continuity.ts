import { z } from 'zod';
export const experienceCartContinuitySchema = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
