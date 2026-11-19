import { z } from 'zod';

const uuid = z.uuid();

export const brilStashBuilderInputSchema = z.strictObject({
  installationId: uuid,
  merchantId: uuid,
  storefrontOrigin: z.url(),
  candidateId: uuid.optional(),
});
