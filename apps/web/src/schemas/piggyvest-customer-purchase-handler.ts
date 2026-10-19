import { z } from 'zod';
import { purchasePreparationSchemas } from './purchase-preparation';
import { purchasePricingSchemas } from './purchase-pricing';

const goalId = z.uuid().transform((value) => value.toLowerCase());
export const piggyvestCustomerPurchaseHandlerSchemas = {
  quote: purchasePricingSchemas.input.extend({
    goalId,
    fulfilmentMode: z.literal('pickup'),
  }),
  prepare: purchasePreparationSchemas.confirmation.extend({
    goalId,
    fulfilmentMode: z.literal('pickup'),
  }),
  status: purchasePreparationSchemas.operation.extend({ goalId }),
};
