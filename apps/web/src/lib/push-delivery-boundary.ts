type DeliveryStartCallback = () => void | Promise<void>;

export interface DeliveryStartBoundary {
  /** Marks dispatch started (idempotent) after invoking the hook. */
  markDeliveryStarted: () => Promise<void>;
  /** Whether dispatch started: anything after this point stays unknown. */
  wasDeliveryStarted: () => boolean;
}

/**
 * Tracks the provider dispatch boundary: chunking and delivery-start
 * failures happen before any request, so the push definitely was not
 * sent and callers can safely retry or fall back to email. Anything
 * after dispatch starts stays unknown.
 */
export function createDeliveryStartBoundary(
  onDeliveryStart?: DeliveryStartCallback
): DeliveryStartBoundary {
  let deliveryStarted = false;

  return {
    markDeliveryStarted: async (): Promise<void> => {
      if (deliveryStarted) return;
      await onDeliveryStart?.();
      deliveryStarted = true;
    },
    wasDeliveryStarted: (): boolean => deliveryStarted,
  };
}

/**
 * Spread `{ deliveryOutcome: 'unknown' }` when the provider may have
 * delivered a push. Single home for the uncertain-outcome vocabulary
 * so call sites cannot drift into neighboring meanings (a failed
 * ticket, an unsent message): unknown is only ever the dispatch
 * boundary's verdict — the call threw after dispatch started, or the
 * chunk path reported uncertainty.
 */
export function unknownDeliveryOutcome(uncertain: boolean): {
  deliveryOutcome?: 'unknown';
} {
  return uncertain ? { deliveryOutcome: 'unknown' } : {};
}
