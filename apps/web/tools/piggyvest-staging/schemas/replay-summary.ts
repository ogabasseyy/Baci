import { z } from 'zod';

const count = z.number().int().min(0).max(10);
const summarySchema = z
  .object({
    replay: z.literal('staging-pass-complete'),
    claimed: count,
    processed: count,
    quarantined: count,
    retryable: count,
    resolutionFailures: count,
  })
  .strict()
  .refine(
    (result) =>
      result.claimed ===
      result.processed +
        result.quarantined +
        result.retryable +
        result.resolutionFailures
  );

export function parseReplaySummary(raw: string) {
  try {
    return summarySchema.parse(JSON.parse(raw));
  } catch {
    throw new Error('Staging replay summary refused');
  }
}
