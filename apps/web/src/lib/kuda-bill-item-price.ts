import type { Biller } from './kuda';
import type { BillItem } from './kuda-bill-items';
import { getBillersByCategory } from './kuda-bills';

const PRICE_LIST_CACHE_TTL_MS = 60_000;

/** Kuda bill types whose packages have fixed prices. */
const FIXED_PRICE_BILL_TYPES = new Set(['cable_tv']);

const priceListCache = new Map<
  string,
  { billers: Biller[]; expiresAt: number }
>();

export function clearKudaBillItemPriceCacheForTests() {
  priceListCache.clear();
}

async function loadPriceList(type: string) {
  const now = Date.now();
  const cached = priceListCache.get(type);
  if (cached && cached.expiresAt > now) {
    return cached.billers;
  }

  const billers = await getBillersByCategory(type);
  priceListCache.set(type, {
    billers,
    expiresAt: now + PRICE_LIST_CACHE_TTL_MS,
  });
  return billers;
}

function findBillItem(
  items: BillItem[] | undefined,
  itemCode: string
): BillItem | undefined {
  for (const item of items ?? []) {
    if (item.itemCode === itemCode) return item;
    const nested = findBillItem(item.billItems, itemCode);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Reject a Kuda fixed-price bill package sent at a price that is no longer
 * Kuda's, before the wallet is charged. Data bundles get the same check in
 * kuda-data-plans; this covers cable TV, whose saved lists could still hold
 * the old 100x prices from before Kuda's kobo amounts were converted.
 * Unknown items are left for Kuda to judge; a price list that cannot be read
 * fails the purchase, as the data check does.
 */
export async function assertKudaBillItemPriceCurrent({
  amount,
  billItemIdentifier,
  type,
}: {
  amount: number;
  billItemIdentifier: string;
  type: string;
}): Promise<void> {
  if (!FIXED_PRICE_BILL_TYPES.has(type)) return;

  const billers = await loadPriceList(type);
  for (const biller of billers) {
    const item = findBillItem(biller.billItems, billItemIdentifier);
    if (!item) continue;
    if (
      item.isAmountFixed &&
      item.amount > 0 &&
      Math.round(item.amount * 100) !== Math.round(amount * 100)
    ) {
      throw new Error(
        `The price of ${item.itemName} has changed. Please refresh and choose your package again.`
      );
    }
    return;
  }
}
