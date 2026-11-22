// Only the bound checkout resolver and database completion fence certify
// this top-level field. Paystack's gross receipt remains intact.
export function readPaystackCheckoutCustomerFeeMinor(
  response: Record<string, unknown>
): number {
  const fee = response.baci_paystack_checkout_customer_fee_minor;
  const charged = response.amount;
  const principal = response.requested_amount;
  return typeof fee === 'number' &&
    Number.isSafeInteger(fee) &&
    fee > 0 &&
    fee === response.fees &&
    typeof charged === 'number' &&
    Number.isSafeInteger(charged) &&
    typeof principal === 'number' &&
    Number.isSafeInteger(principal) &&
    principal > 0 &&
    charged - principal === fee
    ? fee
    : 0;
}
