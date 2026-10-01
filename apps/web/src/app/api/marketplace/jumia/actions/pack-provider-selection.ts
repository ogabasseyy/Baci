export interface PackShipmentProvider {
  id: string;
  trackingCodeRequired: boolean;
}
export interface PackShipmentOrderItem {
  id: string;
  shipmentProviders?: PackShipmentProvider[];
}
export function resolvePackProviders(
  targetItemIds: string[],
  orderItems: PackShipmentOrderItem[],
  shipmentProviderId?: string
) {
  const providerByItem = shipmentProviderId
    ? new Map(targetItemIds.map((id) => [id, shipmentProviderId]))
    : new Map(
        orderItems.flatMap((item) => {
          const provider = item.shipmentProviders?.[0]?.id;
          return provider ? [[item.id, provider] as const] : [];
        })
      );
  const trackingCodeRequired = orderItems.some((item) =>
    item.shipmentProviders?.some(
      (provider) =>
        provider.id === providerByItem.get(item.id) &&
        provider.trackingCodeRequired
    )
  );
  return {
    providerByItem,
    skippedItems: targetItemIds.filter((id) => !providerByItem.has(id)),
    trackingCodeRequired,
  };
}
