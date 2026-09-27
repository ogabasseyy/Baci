/**
 * Tracks the committed order id across the submit flow so post-creation
 * failures report with the order identity: funnel failures serialize
 * behind order_created and join to the order instead of arriving first
 * with an undefined id. Covers both creation paths — the standard
 * createOrder commit and the nested Klump submit, which creates its
 * order inside submitBnplCheckout (via onOrderCreated).
 */
export interface SubmittedOrderIdentity {
  createdOrderId: string | undefined;
  captureCreatedOrder: (orderId: string) => void;
}

export function createSubmittedOrderIdentity(): SubmittedOrderIdentity {
  const identity: SubmittedOrderIdentity = {
    createdOrderId: undefined,
    captureCreatedOrder: (orderId: string) => {
      identity.createdOrderId = orderId;
    },
  };
  return identity;
}
