import { z } from 'zod';

export const staffTopUpSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('cash') }),
  z.strictObject({
    method: z.literal('pos'),
    // Staff attest the terminal's own reference. Signed exports have a separate
    // reference contract for their independently reconciled records.
    receiptReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$/),
  }),
]);
