export type OrderGiglSettlementEconomics = {
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_platform_retained_amount?: number | string | null;
  shipping_provider?: string | null;
};

export function resolveOrderGiglSettlementRpc(
  order: OrderGiglSettlementEconomics | null
) {
  const hasEconomicsSnapshot = order?.shipping_funding_source != null;
  const useGiglSettlementRpc =
    hasEconomicsSnapshot &&
    String(order?.shipping_provider ?? '')
      .trim()
      .toUpperCase() === 'GIGL';
  const retainedShippingAmount =
    order?.shipping_funding_source === 'customer_checkout'
      ? Number(order.shipping_platform_retained_amount ?? 0)
      : 0;

  return {
    hasEconomicsSnapshot,
    retainedShippingAmount: Number.isFinite(retainedShippingAmount)
      ? Math.max(0, retainedShippingAmount)
      : 0,
    settlementRpc: useGiglSettlementRpc
      ? ('record_merchant_settlement_gigl_v1' as const)
      : ('record_merchant_settlement' as const),
    useGiglSettlementRpc,
  };
}
