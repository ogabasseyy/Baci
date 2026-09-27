type ShipmentQuantitySource = {
  fulfillment_data?: unknown;
  quantity: number | null;
};

export function survivingShipmentQuantity(
  item: ShipmentQuantitySource
): number {
  if (item.fulfillment_data && typeof item.fulfillment_data === 'object') {
    const fulfillmentQuantity = (
      item.fulfillment_data as Record<string, unknown>
    ).fulfillmentQuantity;
    if (
      typeof fulfillmentQuantity === 'number' &&
      Number.isInteger(fulfillmentQuantity) &&
      fulfillmentQuantity >= 0
    ) {
      return fulfillmentQuantity;
    }
  }
  return Math.max(0, item.quantity ?? 1);
}
