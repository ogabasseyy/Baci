import { z } from 'zod';

export const compiledCandidateSchema = z.strictObject({
  hostOrigin: z.string().url().optional(),
  javascript: z.string().min(1),
  css: z.string(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  imports: z.array(z.string().max(512)).max(4096),
});
export type CompiledCandidate = z.infer<typeof compiledCandidateSchema>;
