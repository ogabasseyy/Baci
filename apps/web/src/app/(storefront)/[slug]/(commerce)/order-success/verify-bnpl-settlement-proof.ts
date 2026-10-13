/**
 * Proof-bound BNPL settlement verification.
 *
 * A `paid` order row alone is not settlement proof: a provider-side
 * rollback window can transiently flip paid back. The guest verify
 * entry reports success only for completed, paid, and
 * inventory-confirmed transactions, so a paid verdict for this exact
 * order implies the inventory proof. Transport failures and
 * non-success verdicts are not negatives — the caller keeps polling
 * and re-verifies on the next refresh.
 */
export async function verifyBnplSettlementProof({
  orderId,
  orderToken,
  reference,
}: {
  orderId: string;
  orderToken: string;
  reference: string;
}): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      reference,
      trackingToken: orderToken,
    });
    const response = await fetch(`/api/payments/verify?${params.toString()}`);
    if (!response.ok) {
      return false;
    }
    const verdict = (await response.json()) as {
      success?: boolean;
      orderId?: string;
    };
    return verdict?.success === true && verdict?.orderId === orderId;
  } catch {
    return false;
  }
}
