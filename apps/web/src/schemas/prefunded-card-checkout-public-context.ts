import { z } from 'zod';
import { prefundedCardPublicRuntimeSchemas } from './prefunded-card-public-runtime';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export const prefundedCardCheckoutPublicContextSchemas = {
  actor: z.strictObject({ id: uuid, email }),
  configuration: prefundedCardPublicRuntimeSchemas.context,
  customer: z.strictObject({
    id: uuid,
    merchant_id: uuid,
    user_id: uuid,
    email,
  }),
  goal: z.strictObject({ id: uuid, merchant_id: uuid, customer_id: uuid }),
  merchant: z.strictObject({ id: uuid }),
};
