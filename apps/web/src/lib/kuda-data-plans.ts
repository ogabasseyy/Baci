import { flattenKudaDataPlanBillItems } from '@baci/shared/lib';
import {
  type Biller,
  type BillItem,
  getDataProviders,
  type NetworkProvider,
} from '@/lib/kuda';
import { KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE } from '@/lib/kuda-bill-item-price-messages';

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

let dataProvidersCache:
  | {
      expiresAt: number;
      loadedAt: number;
      providers: Biller[];
    }
  | undefined;

export function clearKudaDataPlanCacheForTests() {
  dataProvidersCache = undefined;
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

// Module-scope cache: only minimumFractionDigits varies (0 for integers, 2 otherwise).
const nairaFormatterCache = new Map<number, Intl.NumberFormat>();
function getNairaFormatter(minimumFractionDigits: number): Intl.NumberFormat {
  let formatter = nairaFormatterCache.get(minimumFractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      currency: 'NGN',
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 2,
      minimumFractionDigits,
      style: 'currency',
    });
    nairaFormatterCache.set(minimumFractionDigits, formatter);
  }
  return formatter;
}

function formatNaira(amount: number) {
  return getNairaFormatter(Number.isInteger(amount) ? 0 : 2).format(amount);
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

function providerMatchesNetwork(
  provider: Biller,
  networkProvider: NetworkProvider
) {
  const normalizedProviderName = normalizeComparable(provider.billerName);
  const normalizedNetwork = normalizeComparable(networkProvider);
  if (normalizedNetwork === '9mobile') {
    return (
      normalizedProviderName.includes('9mobile') ||
      normalizedProviderName.includes('9') ||
      normalizedProviderName.includes('t2') ||
      normalizedProviderName.includes('etisalat')
    );
  }

  return normalizedProviderName.includes(normalizedNetwork);
}

/**
 * The current Kuda data plans, or the last good list from the past day when
 * Kuda fails or answers with an empty list. Null when neither exists: the
 * caller must not trust the client's amount then, since apps may still hold
 * plan prices from before Kuda's kobo amounts were converted (100x).
 */
async function loadDataProviders(): Promise<Biller[] | null> {
  const now = Date.now();
  if (dataProvidersCache && dataProvidersCache.expiresAt > now) {
    return dataProvidersCache.providers;
  }
  const lastGood =
    dataProvidersCache &&
    now - dataProvidersCache.loadedAt < DATA_PLAN_LAST_GOOD_MS
      ? dataProvidersCache.providers
      : null;

  let providers: Biller[];
  try {
    providers = await getDataProviders();
  } catch {
    return lastGood;
  }
  if (providers.length === 0) {
    return lastGood;
  }
  dataProvidersCache = {
    expiresAt: now + DATA_PLAN_CACHE_TTL_MS,
    loadedAt: now,
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

function mapUnverifiedDataPlan({
  amount,
  originalDataPlanCode,
  providerName,
}: {
  amount: number;
  originalDataPlanCode: string;
  providerName: string;
}): ResolvedKudaDataPlan {
  return {
    amount,
    isAmountFixed: false,
    itemCode: originalDataPlanCode,
    itemName: originalDataPlanCode,
    originalDataPlanCode,
    providerName,
    resolvedFrom: 'exact_item_code',
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

  // A provider sold without packages has no price to check against.
  if (selectedProviderByCode && !hasLeafBillItems(selectedProviderByCode)) {
    return mapUnverifiedDataPlan({
      amount,
      originalDataPlanCode,
      providerName: selectedProviderByCode?.billerName ?? networkProvider,
    });
  }

  const normalizedCode = normalizeComparable(originalDataPlanCode);
  const exactMatch = candidates.find(
    ({ item }) => normalizeComparable(item.itemCode) === normalizedCode
  );
  if (exactMatch) {
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

  const providerScopedCandidates = candidates.filter(
    ({ provider }) =>
      providerMatchesCode(provider, originalDataPlanCode) ||
      providerMatchesNetwork(provider, networkProvider)
  );
  const amountMatchesForProvider = providerScopedCandidates.filter(({ item }) =>
    amountMatches(item.amount, amount)
  );

  if (amountMatchesForProvider.length === 1) {
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
