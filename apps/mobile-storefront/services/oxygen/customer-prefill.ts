import {
  type OxygenFormDraft,
  oxygenFormDraftSchema,
} from '@baci/shared/oxygen';
import { oxygenOrderPrefill } from './order-prefill';

export function oxygenLinkedCustomerPrefill(
  customer: {
    id: string;
    merchant_id?: string;
    user_id?: string | null;
    first_name?: string;
    last_name?: string;
    email?: string;
    date_of_birth?: string | null;
  } | null,
  owner: { userId: string; customerId: string; merchantId: string },
  orderPrefill: OxygenFormDraft['fields']
): OxygenFormDraft['fields'] {
  if (
    !customer ||
    customer.id !== owner.customerId ||
    customer.user_id !== owner.userId ||
    customer.merchant_id !== owner.merchantId
  )
    return orderPrefill;
  const birthDate =
    oxygenFormDraftSchema.shape.fields.shape.date_of_birth.safeParse(
      customer.date_of_birth
    );
  return {
    ...oxygenOrderPrefill({
      shipping_address: {
        firstName: customer.first_name,
        lastName: customer.last_name,
      },
      customer_email: customer.email,
    }),
    ...(birthDate.success && birthDate.data
      ? { date_of_birth: birthDate.data }
      : {}),
    ...orderPrefill,
  };
}
