import { z } from 'zod';

export const experienceEvidenceId = z.uuid();
export const experienceEvidenceImageRow = z.object({
  merchant_id: z.uuid(),
  evidence_digest: z.string().regex(/^[a-f0-9]{64}$/),
  evidence_bytes: z
    .string()
    .max(4194306)
    .regex(/^\\x(?:[a-f0-9]{2})+$/i),
});
