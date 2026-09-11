const trackedOrderIds = new Set<string>();

export function claimCheckoutPurchaseTracking(orderId: string): boolean {
  if (!orderId || trackedOrderIds.has(orderId)) {
    return false;
  }
  trackedOrderIds.add(orderId);
  return true;
}
