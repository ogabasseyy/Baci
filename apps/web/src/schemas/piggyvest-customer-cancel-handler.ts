import { piggyvestCancellationReviewSchemas } from '@baci/shared/contracts';
import { piggyvestCustomerPolicyContextSchemas } from './piggyvest-customer-policy-context';

export const piggyvestCustomerCancelHandlerSchemas = {
  ...piggyvestCancellationReviewSchemas,
  read: piggyvestCustomerPolicyContextSchemas.input,
  actor: piggyvestCustomerPolicyContextSchemas.actor,
};
