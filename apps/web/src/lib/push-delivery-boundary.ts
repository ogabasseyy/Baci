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
