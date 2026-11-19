/** Request a checkout-scoped recovery proof only for UBA's review flow. */
export function buildSharedCartPrepareInput(
  cart: { cartId: string; version: number },
  paymentMethod: string
) {
  return {
    cartId: cart.cartId,
    expectedVersion: cart.version,
    operationId: crypto.randomUUID(),
    ...(paymentMethod === 'uba_redvault' ? { recoveryForRedvault: true } : {}),
  };
}
