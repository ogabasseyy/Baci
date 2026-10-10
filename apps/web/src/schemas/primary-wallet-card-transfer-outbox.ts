import { z } from 'zod';

export const primaryCardTransferOutboxSchema = z.strictObject({
  operationIds: z.array(z.uuid()).max(1),
  unknownCount: z.number().int().nonnegative().safe(),
  dispatchingCount: z.number().int().nonnegative().safe(),
});
