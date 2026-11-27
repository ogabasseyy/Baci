/**
 * The amount a verified Paystack wallet top-up paid for, in major units.
 *
 * When the Paystack account passes transaction charges to the customer, the
 * verified `amount` is the requested principal plus Paystack's `fees`, while
 * `requested_amount` stays the principal the top-up was started for. A wallet
 * top-up credits only that principal, so the fee the customer paid on top
 * must not read as an amount mismatch.
 *
 * The principal is used only when Paystack's own figures prove the split
 * exactly (charged minus requested equals the reported fee). Anything else
 * falls back to the gross amount, so a malformed or partial answer keeps
 * failing the caller's amount check instead of being credited.
 */
export function readPaystackWalletTopUpAmount(
  response: Record<string, unknown>
): number | null {
  const charged = response.amount;
  if (
    typeof charged !== 'number' ||
    !Number.isSafeInteger(charged) ||
    charged <= 0
  ) {
    return null;
  }

  const requested = response.requested_amount;
  const fees = response.fees;
  const customerPaidFee =
    typeof requested === 'number' &&
    Number.isSafeInteger(requested) &&
    requested > 0 &&
    requested < charged &&
    typeof fees === 'number' &&
    Number.isSafeInteger(fees) &&
    charged - requested === fees;

  return (customerPaidFee ? requested : charged) / 100;
}
