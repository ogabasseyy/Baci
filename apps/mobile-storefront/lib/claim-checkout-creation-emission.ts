export type CreationPurchaseOutcome = 'sent' | 'failed';

// In-flight creation-lane ad purchase emissions by order. The bare claim
// reads "held" from the instant it is granted, but the fire-and-forget
// creation emission may still be running: a settlement that lands in
// that window must await the shared emission instead of trusting the
// claim, or a later rejection loses the purchase while the funnel event
// it already emitted stands. Entries self-remove on settle; a missing
// entry means no emission is running and callers fall back to the claim.
const creationPurchaseInflight = new Map<
  string,
  Promise<CreationPurchaseOutcome>
>();

export function trackCreationPurchaseEmission(
  orderId: string,
  emission: Promise<unknown>
): void {
  if (!orderId) {
    return;
  }
  const outcome = emission.then(
    (): CreationPurchaseOutcome => 'sent',
    (): CreationPurchaseOutcome => 'failed'
  );
  creationPurchaseInflight.set(orderId, outcome);
  void outcome.finally(() => {
    if (creationPurchaseInflight.get(orderId) === outcome) {
      creationPurchaseInflight.delete(orderId);
    }
  });
}

/**
 * Shares the running creation emission, if any. Resolves 'sent' once the
 * ad purchase went out, 'failed' once it rejected (the lane's catch
 * releases the bare claim then), or null when no emission is running —
 * in which case the durable claim is the source of truth. Never rejects.
 */
export async function awaitCreationPurchaseEmission(
  orderId: string
): Promise<CreationPurchaseOutcome | null> {
  const inflight = creationPurchaseInflight.get(orderId);
  if (!inflight) {
    return null;
  }
  return await inflight;
}
