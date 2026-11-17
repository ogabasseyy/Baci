import type { Biller } from './kuda';
import type { BillItem } from './kuda-bill-items';
import { getBillersByCategory } from './kuda-bills';
import { logger } from './logger';

const PRICE_LIST_CACHE_TTL_MS = 60_000;
/** How long a list may stand in for an unreachable Kuda (apps cache a day). */
const PRICE_LIST_LAST_GOOD_MS = 24 * 60 * 60 * 1000;

const priceListCache = new Map<
  string,
  { billers: Biller[]; expiresAt: number; loadedAt: number }
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

  try {
    const billers = await getBillersByCategory(type);
    priceListCache.set(type, {
      billers,
      expiresAt: now + PRICE_LIST_CACHE_TTL_MS,
      loadedAt: now,
    });
    return billers;
  } catch (error) {
    // Kuda unreachable: the last list that loaded still knows today's
    // naira prices, so stale 100x amounts stay blocked through the outage.
    if (cached && now - cached.loadedAt < PRICE_LIST_LAST_GOOD_MS) {
      return cached.billers;
    }
    throw error;
  }
}

function isChosenBiller(biller: Biller, billerName: string) {
  return (
    billerName === biller.billerName ||
    billerName.startsWith(`${biller.billerName} - `)
  );
}

function collectBillItems(
  items: BillItem[] | undefined,
  itemCode: string,
  found: BillItem[]
): BillItem[] {
  for (const item of items ?? []) {
    if (item.itemCode === itemCode) found.push(item);
    collectBillItems(item.billItems, itemCode, found);
  }
  return found;
}

function isStalePrice(item: BillItem, amount: number) {
  return (
    item.isAmountFixed &&
    item.amount > 0 &&
    Math.round(item.amount * 100) !== Math.round(amount * 100)
  );
}

/**
 * Reject a Kuda fixed-price bill package sent at a price that is no longer
 * Kuda's, before the wallet is charged. Data bundles get the same check in
 * kuda-data-plans; this covers the other Kuda bill types (cable TV packages
 * today), whose saved lists could still hold the old 100x prices from before
 * Kuda's kobo amounts were converted. Open-amount items always pass, unknown
 * items are left for Kuda to judge, and every biller listing the item is
 * checked (only the chosen biller's, when the purchase names one that lists
 * it). If Kuda cannot be reached, the last list loaded in the past day is
 * used; with none, the purchase continues like the data check rather than
 * blocking every bill payment during a Kuda outage.
 */
export async function assertKudaBillItemPriceCurrent({
  amount,
  billItemIdentifier,
  billerName,
  type,
}: {
  amount: number;
  billItemIdentifier: string;
  billerName?: string;
  type: string;
}): Promise<void> {
  let billers: Biller[];
  try {
    billers = await loadPriceList(type);
  } catch (error) {
    logger.warn({
      message: 'Kuda price list unavailable; bill price not rechecked',
      error: error instanceof Error ? error.message : String(error),
      type,
    });
    return;
  }

  const listing = billers
    .map((biller) => ({
      biller,
      items: collectBillItems(biller.billItems, billItemIdentifier, []),
    }))
    .filter(({ items }) => items.length > 0);
  const chosen = billerName
    ? listing.filter(({ biller }) => isChosenBiller(biller, billerName))
    : [];
  const matches = (chosen.length > 0 ? chosen : listing).flatMap(
    ({ items }) => items
  );
  const stale = matches.find((item) => isStalePrice(item, amount));
  if (stale) {
    throw new Error(
      `The price of ${stale.itemName} has changed. Please refresh and choose your package again.`
    );
  }
}
