import {
  isKudaElectricityMeterItemCode,
  stripProviderNames,
  withKudaElectricityBillItems,
} from '@baci/shared/lib';
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
 * A fixed price under ₦10 is implausible: the list's units are in doubt
 * (e.g. Kuda switched a list to naira), so it cannot confirm a price.
 */
const IMPLAUSIBLE_FIXED_PRICE_NAIRA = 10;
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

/** The saved list, while it is under a day old at `at`. */
function lastGoodPriceList(type: string, at: number): Biller[] | null {
  const cached = priceListCache.get(type);
  return cached && at - cached.loadedAt < PRICE_LIST_LAST_GOOD_MS
    ? cached.billers
    : null;
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
  const failedAt = lastFailedFetchAt.get(type);
  if (failedAt !== undefined && now - failedAt < PRICE_LIST_RETRY_AFTER_MS) {
    return lastGoodPriceList(type, now);
  }

  // Kuda can take a while to answer, so after a failure the backup list's
  // age and the retry pause are both measured from when the fetch ended.
  const failFetch = (message: string, error?: unknown) => {
    const failedAt = Date.now();
    lastFailedFetchAt.set(type, failedAt);
    const backup = lastGoodPriceList(type, failedAt);
    logger.warn({
      message,
      ...(error !== undefined && {
        error: error instanceof Error ? error.message : String(error),
      }),
      hasLastGoodList: backup !== null,
      type,
    });
    return backup;
  };

  let billers: Biller[];
  try {
    billers = await getBillersByCategory(type, {
      addElectricityMeterItems: false,
    });
  } catch (error) {
    return failFetch('Kuda price list unavailable', error);
  }
  // No biller with any package is a broken answer (every production biller
  // lists packages), so it never replaces a good list.
  if (!billers.some((biller) => biller.billItems?.length)) {
    return failFetch('Kuda price list came back without packages');
  }

  // The meter products are added only after the check above, so Baci's own
  // filler never makes a package-less Kuda answer replace a good list.
  if (type === 'electricity') {
    billers = withKudaElectricityBillItems(billers);
  }

  lastFailedFetchAt.delete(type);
  const loadedAt = Date.now();
  priceListCache.set(type, {
    billers,
    expiresAt: loadedAt + PRICE_LIST_CACHE_TTL_MS,
    loadedAt,
  });
  return billers;
}

function normalizeBillerName(name: string) {
  return stripProviderNames(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The purchase names this biller, as the billers list showed it. */
function namesMatch(listed: string, sent: string) {
  return listed !== '' && (sent === listed || sent.startsWith(`${listed} - `));
}

function plainBillerName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The listings under the biller the purchase names: an exact (case and
 * space free) name match first, so two billers that only differ by a
 * provider tag stay apart; the provider-stripped name (as the billers list
 * shows it) only when nothing matches exactly.
 */
function chosenListings<T extends { biller: Biller }>(
  listing: T[],
  billerName: string
): T[] {
  // Most specific first: a literal name match, then the checkout's decorated
  // "<biller> - <package group>" form, each before the provider-stripped
  // name. A purchase naming "DSTV - PREMIUM" therefore uses that biller's
  // own listings and never also a plain "DSTV" listing's price.
  const sentPlain = plainBillerName(billerName);
  const sentNormalized = normalizeBillerName(billerName);
  const tiers: Array<(listed: Biller) => boolean> = [
    (listed) => plainBillerName(listed.billerName) === sentPlain,
    (listed) => namesMatch(plainBillerName(listed.billerName), sentPlain),
    (listed) => {
      const name = normalizeBillerName(listed.billerName);
      return name !== '' && name === sentNormalized;
    },
    (listed) =>
      namesMatch(normalizeBillerName(listed.billerName), sentNormalized),
  ];
  for (const matches of tiers) {
    const found = listing.filter(({ biller }) => matches(biller));
    if (found.length > 0) return found;
  }
  return [];
}

/** Item codes compared like the data-plan check does: case and punctuation free. */
function normalizeItemCode(code: string) {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function collectBillItems(
  items: BillItem[] | undefined,
  itemCode: string,
  found: BillItem[]
): BillItem[] {
  for (const item of items ?? []) {
    if (normalizeItemCode(item.itemCode) === itemCode) found.push(item);
    collectBillItems(item.billItems, itemCode, found);
  }
  return found;
}

function hasFixedPrice(item: BillItem) {
  return item.isAmountFixed;
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
 * The package must still be listed (under the named biller, when the
 * purchase names one), and its amount must match one of those listings, so
 * a different price at another biller never declines a valid purchase
 * while a stale 100x amount (which matches none) is caught. Open-amount
 * packages pass at any amount; an implausible or unreadable fixed price
 * (under ₦10, including 0) means the list can't confirm anything. If no price list is available (Kuda
 * down or empty, with no good list from the past day in this server
 * instance), every purchase fails closed except Kuda's listed electricity
 * meter products.
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
    // Kuda's listed electricity meter products are always sold at the
    // customer's own amount, so no saved price can go stale; every other
    // purchase fails closed until a list is available.
    if (
      type === 'electricity' &&
      isKudaElectricityMeterItemCode(billItemIdentifier)
    ) {
      return;
    }
    throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  }

  const listing = billers
    .map((biller) => ({
      biller,
      items: collectBillItems(
        biller.billItems,
        normalizeItemCode(billItemIdentifier),
        []
      ),
    }))
    .filter(({ items }) => items.length > 0);
  // The current list no longer offers this package (or not under the named
  // biller): the app's saved choice, and its price, are out of date.
  const chosen = billerName ? chosenListings(listing, billerName) : listing;
  if (chosen.length === 0) {
    // Kuda's listed electricity meter products are always customer-priced,
    // so a partial list that leaves out their biller cannot make them stale.
    if (
      type === 'electricity' &&
      isKudaElectricityMeterItemCode(billItemIdentifier)
    ) {
      return;
    }
    throw new Error(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  }

  // Each biller's fixed listings, kept apart so that with no biller named
  // every biller offering the package has to confirm the price itself.
  const fixedByBiller = chosen
    .map(({ items }) => items.filter(hasFixedPrice))
    .filter((items) => items.length > 0);
  const fixed = fixedByBiller.flat();
  if (fixed.length === 0) return; // sold at the customer's own amount
  // An unreadable (mapped to 0) or implausible (under ₦10) fixed price is
  // never treated as an open amount. It is skipped when another listing can
  // still confirm the price, and fails closed when none can.
  const plausible = fixed.filter(
    (item) => item.amount >= IMPLAUSIBLE_FIXED_PRICE_NAIRA
  );
  if (plausible.length === 0) {
    throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  }
  if (plausible.length < fixed.length) {
    logger.warn({
      message: 'Kuda price list has an unreadable or implausible listing',
      billItemIdentifier,
      type,
    });
  }
  // With no biller named, a biller whose listings are all unreadable can't
  // confirm the price, so the purchase fails closed rather than trusting
  // another biller alone.
  if (
    !billerName &&
    fixedByBiller.some((items) =>
      items.every((item) => item.amount < IMPLAUSIBLE_FIXED_PRICE_NAIRA)
    )
  ) {
    throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  }
  // Under a named biller one of its listings must match; with no biller
  // named, every listing must agree, so the cheapest of two billers' prices
  // can never pass for the other. Current web and mobile checkouts always
  // send the biller name shown in the billers list, so the strict branch
  // only meets older clients, which get "refresh" rather than a wrong price.
  const isCurrent = billerName
    ? plausible.some((item) => priceMatches(item, amount))
    : plausible.every((item) => priceMatches(item, amount));
  if (!isCurrent) {
    throw new Error(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  }
}
