import { z } from 'zod';

const operationId = z.uuid();
const imei = z
  .string()
  .regex(/^[A-Za-z0-9]{8,15}$/, 'Enter a valid IMEI or serial number');

// The client never sends an amount, purpose or purchase: the server reads
// them from the payment it issued for the lookup.
export const imeiWalletPaySchemas = {
  pinRequest: z.strictObject({
    operationId,
    pin: z.string().regex(/^[0-9]{4,6}$/),
  }),
  // pinProof is empty on a status re-check of a payment already sent; the
  // database ignores the proof for anything past 'issued'. The IMEI is re-sent
  // so delivery never needs a stored plaintext identifier; the server checks
  // it against the lookup's stored hash.
  payRequest: z.strictObject({
    operationId,
    pinProof: z
      .union([z.literal(''), z.string().regex(/^[0-9a-f]{64}$/)])
      .default(''),
    imei,
  }),
};
