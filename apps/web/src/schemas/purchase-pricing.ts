import { z } from 'zod';
import { SavingsDeviceProductSchema } from '@/lib/customer-savings-device';
import { piggyvestCustomerPolicyContextSchemas } from './piggyvest-customer-policy-context';
import { purchasePreparationSchemas } from './purchase-preparation';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const result = z.strictObject({
  status: z.literal('quote_available'),
  fulfilmentMode: z.literal('pickup'),
  shippingRateId: uuid,
  pickupName: z.string().min(1).max(200),
  pickupAddress: z.object({
    address: z.string().min(1),
    city: z.string().min(1),
    countryCode: z.literal('NG'),
  }),
  taxTreatment: z.enum([
    'exclusive_device',
    'included_device',
    'not_applicable',
  ]),
  includedTaxKobo: z.number().int().safe().nonnegative(),
  feePolicyVersion: z.string().min(1).max(64),
  quote: purchasePreparationSchemas.quote,
});
export const purchasePricingSchemas = {
  input: z.strictObject({
    quoteId: uuid,
    shippingRateId: uuid,
    savingsKobo: z.number().int().safe().positive(),
  }),
  actor: piggyvestCustomerPolicyContextSchemas.actor,
  goal: piggyvestCustomerPolicyContextSchemas.goal.extend({
    product_id: uuid,
    variant_id: uuid.nullable(),
  }),
  product: SavingsDeviceProductSchema,
  result,
  rows: z.array(z.strictObject({ result })).length(1),
};
