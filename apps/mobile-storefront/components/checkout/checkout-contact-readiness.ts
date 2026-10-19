import type { ShippingAddressInput } from '@/lib/validation';
import { CheckoutContactSchema } from '@/lib/validation';

type CheckoutContactFields = Partial<
  Pick<ShippingAddressInput, 'email' | 'firstName' | 'lastName' | 'phone'>
>;

export function isCheckoutContactComplete(
  fields: CheckoutContactFields
): boolean {
  return CheckoutContactSchema.safeParse(fields).success;
}
