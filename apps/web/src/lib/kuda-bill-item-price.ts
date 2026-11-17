import { stripProviderNames } from '@baci/shared/lib';
import type { Biller } from './kuda';
import {
  KUDA_BILL_PRICE_CHANGED_MESSAGE,
  KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE,
} from './kuda-bill-item-price-messages';
import type { BillItem } from './kuda-bill-items';
import { getBillersByCategory } from './kuda-bills';
import { logger } from './logger';

const PRICE_LIST_CACHE_TTL_MS = 60_000;
/**
 * How long a list may stand in for an unreachable Kuda (apps cache a day).
 * The cache lives in this server instance's memory, so a freshly started
 * instance has no last good list; it then fails closed below.
 */
const PRICE_LIST_LAST_GOOD_MS = 24 * 60 * 60 * 1000;
/**
 * Kuda bill types sold at the customer's own amount (electricity items are
 * synthesized open-amount), so a saved 100x price cannot exist for them.
 */
const OPEN_AMOUNT_BILL_TYPES = new Set(['electricity']);
/** After a failed or empty fetch, wait this long before asking Kuda again. */
const PRICE_LIST_RETRY_AFTER_MS = 30_000;

const priceListCache = new Map<
  string,
  { billers: Biller[]; expiresAt: number; loadedAt: number }
>();
const lastFailedFetchAt = new Map<string, number>();

export function clearKudaBillItemPriceCacheForTests() {
  priceListCache.clear();
  lastFailedFetchAt.clear();
}

/**
 * The current price list, or the last good one from the past day when Kuda
 * fails or answers with an empty list (an application-level Kuda failure
 * resolves to [] rather than throwing). Returns null when neither exists.
 */
async function loadPriceList(type: string): Promise<Biller[] | null> {
  const now = Date.now();
  const cached = priceListCache.get(type);
  if (cached && cached.expiresAt > now) {
    return cached.billers;
  }
  const lastGood =
    cached && now - cached.loadedAt < PRICE_LIST_LAST_GOOD_MS
      ? cached.billers
      : null;
  const failedAt = lastFailedFetchAt.get(type);
  if (failedAt !== undefined && now - failedAt < PRICE_LIST_RETRY_AFTER_MS) {
    return lastGood;
  }

  let billers: Biller[];
  try {
    billers = await getBillersByCategory(type);
  } catch (error) {
    lastFailedFetchAt.set(type, now);
    logger.warn({
      message: 'Kuda price list unavailable',
      error: error instanceof Error ? error.message : String(error),
      hasLastGoodList: lastGood !== null,
      type,
    });
    return lastGood;
  }
  if (billers.length === 0) {
    lastFailedFetchAt.set(type, now);
    logger.warn({
      message: 'Kuda price list came back empty',
      hasLastGoodList: lastGood !== null,
      type,
    });
    return lastGood;
  }

  lastFailedFetchAt.delete(type);
  priceListCache.set(type, {
    billers,
    expiresAt: now + PRICE_LIST_CACHE_TTL_MS,
    loadedAt: now,
  });
  return billers;
}

function normalizeBillerName(name: string) {
  return stripProviderNames(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The purchase names this biller, as the billers list showed it. */
function isChosenBiller(biller: Biller, billerName: string) {
  const listed = normalizeBillerName(biller.billerName);
  const sent = normalizeBillerName(billerName);
  return listed !== '' && (sent === listed || sent.startsWith(`${listed} - `));
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

function hasFixedPrice(item: BillItem) {
  return item.isAmountFixed && item.amount > 0;
}

function priceMatches(item: BillItem, amount: number) {
  return Math.round(item.amount * 100) === Math.round(amount * 100);
}

/**
 * Reject a Kuda fixed-price bill package sent at a price that is no longer
 * Kuda's, before the wallet is charged. Data bundles get the same check in
 * kuda-data-plans; this covers the other Kuda bill types (cable TV packages
 * today), whose saved lists could still hold the old 100x prices from before
 * Kuda's kobo amounts were converted.
 *
 * When the purchase names a biller that lists the item, the amount must
 * match that biller's listing; otherwise it must match at least one listing.
 * Either way a different price elsewhere never declines a valid purchase,
 * while a stale 100x amount (which matches none) is still caught.
 * Open-amount and unknown items pass. If no price list is available (Kuda
 * down or empty, with no good list from the past day in this server
 * instance), every bill type fails closed except open-amount electricity.
 * After a failed fetch Kuda is not asked again for 30 seconds.
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
  const billers = await loadPriceList(type);
  if (billers === null) {
    // Open-amount electricity carries no saved price to go stale, so it
    // continues; every other type fails closed until a list is available.
    if (OPEN_AMOUNT_BILL_TYPES.has(type)) return;
    throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  }

  const listing = billers
    .map((biller) => ({
      biller,
      items: collectBillItems(biller.billItems, billItemIdentifier, []).filter(
        hasFixedPrice
      ),
    }))
    .filter(({ items }) => items.length > 0);
  if (listing.length === 0) return;

  const chosen = billerName
    ? listing.filter(({ biller }) => isChosenBiller(biller, billerName))
    : [];
  const isCurrent = (chosen.length > 0 ? chosen : listing).some(({ items }) =>
    items.some((item) => priceMatches(item, amount))
  );
  if (!isCurrent) {
    throw new Error(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  }
}
