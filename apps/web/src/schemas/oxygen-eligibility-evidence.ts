import { z } from 'zod';

export const oxygenEligibilityEvidenceQuery = z.object({
  workflowId: z.uuid(),
  commandId: z.uuid(),
});

export const oxygenEligibilityEvidenceRecord = z.object({
  operation: z.literal('eligibility'),
  httpStatus: z.number().int().min(100).max(599),
  eligibilityRaw: z.discriminatedUnion('capture', [
    z.object({
      capture: z.literal('complete'),
      bodyBase64: z
        .string()
        .max(16000)
        .regex(
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
        ),
    }),
    z.object({
      capture: z.enum(['oversized', 'unavailable', 'non_json', 'parsed']),
    }),
  ]),
});
