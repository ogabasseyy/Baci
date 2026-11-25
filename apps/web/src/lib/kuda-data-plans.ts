import { flattenKudaDataPlanBillItems } from '@baci/shared/lib';
import {
  type Biller,
  type BillItem,
  getDataProviders,
  type NetworkProvider,
} from '@/lib/kuda';
import { KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE } from '@/lib/kuda-bill-item-price-messages';
import { logger } from '@/lib/logger';
import { formatNaira } from './kuda-format-naira';
import { normalizeKudaItemCode } from './kuda-item-code';
import { isKudaNoResponse } from './kuda-no-response';
import { providerMatchesNetwork } from './kuda-provider-matches-network';

const DATA_PLAN_CACHE_TTL_MS = 60_000;

interface DataPlanCandidate {
  item: BillItem;
  provider: Biller;
}

export interface ResolvedKudaDataPlan {
  amount: number;
  isAmountFixed: boolean;
  itemCode: string;
  itemName: string;
  originalDataPlanCode: string;
  providerName: string;
  resolvedFrom: 'exact_item_code' | 'provider_amount';
}

/** Same window as the bill price recheck: apps cache plan lists a day. */
const DATA_PLAN_LAST_GOOD_MS = 24 * 60 * 60 * 1000;
/** After a failed or unusable fetch, wait this long before asking Kuda again. */
const DATA_PLAN_RETRY_AFTER_MS = 30_000;
/** A fixed plan price under ₦10 means the list's units are in doubt. */
const IMPLAUSIBLE_PLAN_PRICE_NAIRA = 10;

/** When the last fetch failed, and whether Kuda's answer was refused. */
let lastFailedDataPlanFetch: { at: number; refused: boolean } | undefined;

let dataProvidersCache:
  | {
      expiresAt: number;
      loadedAt: number;
      providers: Biller[];
    }
  | undefined;

export function clearKudaDataPlanCacheForTests() {
  dataProvidersCache = undefined;
  lastFailedDataPlanFetch = undefined;
}

function normalizeComparable(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function amountMatches(a: number, b: number) {
  return Math.round(a * 100) === Math.round(b * 100);
}

function collectDataPlanCandidates(providers: Biller[]): DataPlanCandidate[] {
  return providers.flatMap((provider) =>
    flattenKudaDataPlanBillItems<BillItem>(provider.billItems).map((item) => ({
      item,
      provider,
    }))
  );
}

function providerMatchesCode(provider: Biller, dataPlanCode: string) {
  const normalizedCode = normalizeComparable(dataPlanCode);
  return (
    normalizeComparable(provider.billerId) === normalizedCode ||
    normalizeComparable(provider.billerName) === normalizedCode
  );
}

/** The saved data plans, while they are under a day old at `at`. */
function lastGoodDataProviders(at: number): Biller[] | null {
  return dataProvidersCache &&
    at - dataProvidersCache.loadedAt < DATA_PLAN_LAST_GOOD_MS
    ? dataProvidersCache.providers
    : null;
}

/**
 * The current Kuda data plans, or the last good list from the past day only
 * when Kuda gave no answer (an HTTP error, timeout or dropped connection).
 * An answer Baci can't trust (no packages, wrong unit, broken body) is
 * refused, never covered by the saved list. After a failed fetch Kuda is not
 * asked again for 30 seconds. Null when no list can be used: the caller must
 * not trust the client's amount then (apps may hold 100x kobo prices).
 */
async function loadDataProviders(): Promise<Biller[] | null> {
  const now = Date.now();
  if (dataProvidersCache && dataProvidersCache.expiresAt > now) {
    return dataProvidersCache.providers;
  }
  const failure = lastFailedDataPlanFetch;
  if (failure && now - failure.at < DATA_PLAN_RETRY_AFTER_MS) {
    return failure.refused ? null : lastGoodDataProviders(now);
  }

  // Kuda can take a while to answer, so after a failure the backup list's
  // age and the retry pause are both measured from when the fetch ended.
  const failFetch = (message: string, refused: boolean, error?: unknown) => {
    const failedAt = Date.now();
    lastFailedDataPlanFetch = { at: failedAt, refused };
    if (refused) dataProvidersCache = undefined; // not revived by a timeout
    const backup = refused ? null : lastGoodDataProviders(failedAt);
    logger.warn({
      message,
      ...(error !== undefined && {
        error: error instanceof Error ? error.message : String(error),
      }),
      hasLastGoodList: backup !== null,
      type: 'data',
    });
    return backup;
  };

  let providers: Biller[];
  try {
    providers = await getDataProviders();
  } catch (error) {
    return isKudaNoResponse(error)
      ? failFetch('Kuda data plan list unavailable', false, error)
      : failFetch('Kuda data plan list answer refused', true, error);
  }
  if (collectDataPlanCandidates(providers).length === 0) {
    return failFetch('Kuda data plan list came back without packages', true);
  }
  lastFailedDataPlanFetch = undefined;
  const loadedAt = Date.now(); // from when Kuda answered, like failures
  dataProvidersCache = {
    expiresAt: loadedAt + DATA_PLAN_CACHE_TTL_MS,
    loadedAt,
    providers,
  };
  return providers;
}

function mapResolvedCandidate(
  candidate: DataPlanCandidate,
  originalDataPlanCode: string,
  resolvedFrom: ResolvedKudaDataPlan['resolvedFrom'],
  amountOverride?: number
): ResolvedKudaDataPlan {
  return {
    amount: amountOverride ?? candidate.item.amount,
    isAmountFixed: candidate.item.isAmountFixed,
    itemCode: candidate.item.itemCode,
    itemName: candidate.item.itemName,
    originalDataPlanCode,
    providerName: candidate.provider.billerName,
    resolvedFrom,
  };
}

function hasLeafBillItems(provider: Biller) {
  return flattenKudaDataPlanBillItems<BillItem>(provider.billItems).length > 0;
}

export async function resolveKudaDataPlanForPurchase({
  amount,
  dataPlanCode,
  networkProvider,
}: {
  amount: number;
  dataPlanCode: string | undefined;
  networkProvider: NetworkProvider;
}): Promise<ResolvedKudaDataPlan> {
  const originalDataPlanCode = dataPlanCode?.trim();
  if (!originalDataPlanCode) {
    throw new Error('Data plan code is required for data purchases');
  }

  const providers = await loadDataProviders();
  if (providers === null) {
    // Data bundles are only sold through Kuda, so with its plan list down
    // the purchase could not go through anyway; failing here stops a saved
    // 100x price from being charged.
    throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  }

  const selectedProviderByCode =
    providers.find((provider) =>
      providerMatchesCode(provider, originalDataPlanCode)
    ) ?? null;
  const candidates = collectDataPlanCandidates(providers);
  if (candidates.length === 0) {
    // A list with no packages at all is a broken answer, not a price list:
    // the client's (possibly 100x) amount cannot be checked against it.
    throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  }

  // A selected provider listed without packages gives no price to check the
  // app's (possibly 100x) amount against, so it fails closed too.
  if (selectedProviderByCode && !hasLeafBillItems(selectedProviderByCode)) {
    throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  }

  const normalizedCode = normalizeComparable(originalDataPlanCode);
  // A plan Kuda listed with an unusable price was dropped by the mapper. It
  // fails closed here instead of falling through to the amount fallback
  // below, which could sell a different plan at the same price.
  if (
    providers.some((provider) =>
      provider.unreadableItemCodes?.some(
        (code) => normalizeKudaItemCode(code) === normalizedCode
      )
    )
  ) {
    throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  }
  const exactMatch = candidates.find(
    ({ item }) => normalizeComparable(item.itemCode) === normalizedCode
  );
  if (exactMatch) {
    // A malformed plan list (this provider's or another on the network) may
    // hide the same code at another price, so no plan can be confirmed.
    const hidden = (p: Biller) =>
      p.packagesUnreadable &&
      (p === exactMatch.provider || providerMatchesNetwork(p, networkProvider));
    if (providers.some(hidden))
      throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    // Includes an unreadable fixed price (mapped to 0).
    if (
      exactMatch.item.isAmountFixed &&
      exactMatch.item.amount < IMPLAUSIBLE_PLAN_PRICE_NAIRA
    ) {
      throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    }
    if (
      exactMatch.item.isAmountFixed &&
      exactMatch.item.amount > 0 &&
      !amountMatches(exactMatch.item.amount, amount)
    ) {
      throw new Error(
        `Data bundle amount changed for ${exactMatch.item.itemName}. Please refresh data bundles and select a package.`
      );
    }

    return mapResolvedCandidate(
      exactMatch,
      originalDataPlanCode,
      'exact_item_code',
      exactMatch.item.isAmountFixed ? undefined : amount
    );
  }

  // The amount fallback can't tell a dropped plan from a stale one, so a
  // provider in scope with a dropped plan or an unreadable package list
  // (including one named instead of a plan code) makes it fail closed.
  if (
    providers.some(
      (provider) =>
        (provider.unreadableItemCodes?.length || provider.packagesUnreadable) &&
        (providerMatchesCode(provider, originalDataPlanCode) ||
          providerMatchesNetwork(provider, networkProvider))
    )
  ) {
    throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  }
  const providerScopedCandidates = candidates.filter(
    ({ provider }) =>
      providerMatchesCode(provider, originalDataPlanCode) ||
      providerMatchesNetwork(provider, networkProvider)
  );
  const amountMatchesForProvider = providerScopedCandidates.filter(({ item }) =>
    amountMatches(item.amount, amount)
  );

  if (amountMatchesForProvider.length === 1) {
    const { item } = amountMatchesForProvider[0];
    if (item.isAmountFixed && item.amount < IMPLAUSIBLE_PLAN_PRICE_NAIRA) {
      throw new Error(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
    }
    return mapResolvedCandidate(
      amountMatchesForProvider[0],
      originalDataPlanCode,
      'provider_amount'
    );
  }

  if (amountMatchesForProvider.length > 1) {
    throw new Error(
      `Multiple data bundles match ${networkProvider} at ${formatNaira(amount)}. Please refresh data bundles and select a package.`
    );
  }

  throw new Error(
    `Data bundle not found for ${networkProvider} at ${formatNaira(amount)}. Please refresh data bundles and select a package.`
  );
}
