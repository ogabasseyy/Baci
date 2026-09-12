import { isProductNegotiable } from './negotiation-policy';

export interface RedvaultEligibilityInput {
  brand: string | null;
  name: string | null;
}

export function isRedvaultEligibleProduct(
  input: RedvaultEligibilityInput
): boolean {
  return isProductNegotiable(input);
}
