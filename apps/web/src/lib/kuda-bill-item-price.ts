import {
  isKudaElectricityMeterItemCode,
  withKudaElectricityBillItems,
} from '@baci/shared/lib';
import type { Biller } from './kuda';
import {
  KUDA_BILL_PRICE_CHANGED_MESSAGE,
  KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE,
} from './kuda-bill-item-price-messages';
import type { BillItem } from './kuda-bill-items';
import { chosenListings } from './kuda-biller-name-match';
import { getBillersByCategory } from './kuda-bills';
import { normalizeKudaItemCode } from './kuda-item-code';
import { isKudaNoResponse } from './kuda-no-response';
import { isPackageNamePath } from './kuda-package-name-path';
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
/** When the last fetch failed, and whether Kuda's answer was refused. */
const lastFailedFetch = new Map<string, { at: number; refused: boolean }>();

export function clearKudaBillItemPriceCacheForTests() {
  priceListCache.clear();
  lastFailedFetch.clear();
}

/** The saved list, while it is under a day old at `at`. */
function lastGoodPriceList(type: string, at: number): Biller[] | null {
  const cached = priceListCache.get(type);
  return cached && at - cached.loadedAt < PRICE_LIST_LAST_GOOD_MS
    ? cached.billers
    : null;
}

/**
 * The current price list, or the last good one from the past day only when
 * Kuda gave no answer at all (an HTTP error, timeout or dropped connection).
 * When Kuda answers with something Baci can't trust (no packages, refused
 * as priced in the wrong unit, a broken body) the purchase fails closed:
 * the saved list never stands in for an answer that disagrees with it.
 * Returns null when no list can be used.
 */
async function loadPriceList(type: string): Promise<Biller[] | null> {
  const now = Date.now();
  const cached = priceListCache.get(type);
  if (cached && cached.expiresAt > now) {
    return cached.billers;
  }
  const failure = lastFailedFetch.get(type);
  if (failure && now - failure.at < PRICE_LIST_RETRY_AFTER_MS) {
    return failure.refused ? null : lastGoodPriceList(type, now);
  }

  // Kuda can take a while to answer, so after a failure the backup list's
  // age and the retry pause are both measured from when the fetch ended.
  const failFetch = (message: string, refused: boolean, error?: unknown) => {
    const failedAt = Date.now();
    lastFailedFetch.set(type, { at: failedAt, refused });
    // A refused answer disagrees with the saved list, so the saved list is
    // dropped: a later timeout can never bring its old prices back.
    if (refused) priceListCache.delete(type);
    const backup = refused ? null : lastGoodPriceList(type, failedAt);
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
    return isKudaNoResponse(error)
      ? failFetch('Kuda price list unavailable', false, error)
      : failFetch('Kuda price list answer refused', true, error);
  }
  // No biller with any package is a broken answer (every production biller
  // lists packages): it is refused, and never replaces a good list.
  if (!billers.some((biller) => biller.billItems?.length)) {
    return failFetch('Kuda price list came back without packages', true);
  }

  // The meter products are added only after the check above, so Baci's own
  // filler never makes a package-less Kuda answer replace a good list.
  if (type === 'electricity') {
    billers = withKudaElectricityBillItems(billers);
  }

  lastFailedFetch.delete(type);
  const loadedAt = Date.now();
  priceListCache.set(type, {
    billers,
    expiresAt: loadedAt + PRICE_LIST_CACHE_TTL_MS,
    loadedAt,
  });
  return billers;
}

function collectBillItems(
  items: BillItem[] | undefined,
  itemCode: string,
  found: BillItem[]
): BillItem[] {
  for (const item of items ?? []) {
    if (normalizeKudaItemCode(item.itemCode) === itemCode) found.push(item);
    collectBillItems(item.billItems, itemCode, found);
  }
  return found;
}

/** Stands in for a listing the mapper dropped for an unusable price. */
const UNREADABLE_LISTING: BillItem = {
  amount: 0,
  isAmountFixed: true,
  itemCode: '',
  itemCurrencySymbol: 'NGN',
  itemFee: 0,
  itemName: 'Unreadable price',
};

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
 * (under ₦10, including 0) means the list can't confirm anything. A list
 * from the past day stands in only when Kuda gives no answer at all; an
 * answer Baci refuses (empty, no packages, priced in the wrong unit, broken)
 * drops the saved list, and every purchase then fails closed until Kuda
 * answers well. Kuda's electricity meter products, always sold at the
 * customer's own amount, pass in every case.
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
  // Kuda's listed electricity meter products are always sold at the
  // customer's own amount: no saved price can go stale and no list state
  // (missing, partial, or a biller marked unreadable) can make them so.
  if (
    type === 'electricity' &&
    isKudaElectricityMeterItemCode(billItemIdentifier)
  ) {
    return;
  }
  const billers = await loadPriceList(type);
  // Every other purchase fails closed until a list is available.
  if (billers === null) throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);

  const code = normalizeKudaItemCode(billItemIdentifier);
  const offers = (biller: Biller) => {
    const items = collectBillItems(biller.billItems, code, []);
    // A listing Kuda sent with an unusable price was dropped by the mapper;
    // it stands in here as an unreadable (₦0) fixed price, so its biller
    // can never be skipped as if it didn't offer the package.
    if (
      biller.packagesUnreadable ||
      biller.unreadableItemCodes?.some(
        (unreadable) => normalizeKudaItemCode(unreadable) === code
      )
    ) {
      items.push({ ...UNREADABLE_LISTING, itemCode: billItemIdentifier });
    }
    return { biller, items };
  };
  // The named biller is chosen from the whole list first, then its package
  // looked up, so a biller that stopped offering it never falls back to a
  // shorter-named biller that still does (and to that biller's price).
  const candidates = billerName
    ? chosenListings(
        billers.map((biller) => ({ biller })),
        billerName,
        // The path is checked against the biller's packages; a biller that
        // dropped this code as unreadable still owns it (then fails closed).
        (listed, path) =>
          isPackageNamePath(listed.billItems, code, path) ||
          listed.packagesUnreadable === true ||
          (listed.unreadableItemCodes ?? []).some(
            (unreadable) => normalizeKudaItemCode(unreadable) === code
          )
      ).map(({ biller }) => offers(biller))
    : billers.map(offers);
  // The current list no longer offers this package (or not under the named
  // biller): the app's saved choice, and its price, are out of date.
  const chosen = candidates.filter(({ items }) => items.length > 0);
  if (chosen.length === 0) throw new Error(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  // A biller whose package list was malformed can't confirm any price, even
  // one it lists readably: the hidden part may hold the same package. With
  // no biller named (older clients only) every biller is a candidate, so one
  // malformed biller deliberately blocks the whole category: which biller's
  // package it is can't be told, and failing closed is the safe side.
  // Likewise a biller that sent this code with an unusable price, even if
  // another copy of it is readable: the dropped copy can't be confirmed.
  if (
    chosen.some(
      ({ biller }) =>
        biller.packagesUnreadable ||
        biller.unreadableItemCodes?.some(
          (unreadable) => normalizeKudaItemCode(unreadable) === code
        )
    )
  ) {
    throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
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
