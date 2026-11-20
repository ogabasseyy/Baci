import { KUDA_ELECTRICITY_BILL_ITEMS_BY_PROVIDER } from './kuda-electricity-provider-items';

const ELECTRICITY_METER_ITEM_CODES = new Set(
  Object.values(KUDA_ELECTRICITY_BILL_ITEMS_BY_PROVIDER).flatMap((items) =>
    items.map((item) => item.itemCode.toUpperCase())
  )
);

/**
 * Whether a code is one of Kuda's electricity meter products (see kuda-electricity-provider-items.ts),
 * which are always sold at the customer's own amount.
 */
export function isKudaElectricityMeterItemCode(itemCode: string): boolean {
  return ELECTRICITY_METER_ITEM_CODES.has(itemCode.trim().toUpperCase());
}
