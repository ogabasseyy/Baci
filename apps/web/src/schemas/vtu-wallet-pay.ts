import { z } from 'zod';

// The client never sends an amount or purpose: the server reads them from
// the payment it issued for the purchase.
export const vtuWalletPaySchemas = {
  pinRequest: z.strictObject({
    transactionId: z.uuid(),
    operationId: z.uuid(),
    pin: z.string().regex(/^[0-9]{4,6}$/),
  }),
};
