import { z } from 'zod';

export const replaySignatureLookupSchema = z.strictObject({
  receiptId: z.uuid(),
  payloadSha256: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]+$/),
  claimToken: z.uuid(),
});
