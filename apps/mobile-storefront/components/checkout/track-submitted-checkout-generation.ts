export function trackSubmittedCheckoutGeneration(fallbackGeneration: string): {
  current: () => string;
  track: (orderResponse: { effectiveCheckoutGeneration?: string }) => void;
} {
  // The generation the order was actually submitted under. createOrder
  // resolves the stale cart snapshot against the durable restore, and
  // every recovery step must follow the submitted identity — not the
  // snapshot — or a retry forks the idempotency key and duplicates the
  // order. Until createOrder returns, no order exists, so the snapshot
  // remains the correct identity for the pre-submit path.
  let submitted = fallbackGeneration;
  return {
    current: () => submitted,
    track: (orderResponse) => {
      submitted =
        orderResponse.effectiveCheckoutGeneration ?? fallbackGeneration;
    },
  };
}
