import {
  type ShippingAddressInput,
  ShippingAddressSchema,
} from '@/lib/validation';

type CheckoutAddressFields = Pick<
  ShippingAddressInput,
  'email' | 'firstName' | 'lastName' | 'phone' | 'address' | 'city' | 'state'
>;

export function isCheckoutAddressComplete(
  fields: CheckoutAddressFields
): boolean {
  return ShippingAddressSchema.safeParse(fields).success;
}
