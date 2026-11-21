import { z } from 'zod';

export const brilStashProbeInputSchema = z.strictObject({
  installationId: z.uuid(),
  expectedGenerationId: z.uuid(),
  expectedPayloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
