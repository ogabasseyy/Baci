import { analyzeFastCatalogBudget } from './fast-catalog-budget';

export interface CatalogBudgetLimit {
  amount: number;
  exclusive: boolean;
}

export type CatalogChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

const BUDGET_OVERRIDE_CUE =
  /\b(?:ignore\s+(?:the\s+|my\s+)?budget|no\s+budget|any\s+price|higher\s+budget|more\s+expensive|over\s+(?:my\s+|the\s+)?budget|above\s+(?:my\s+|the\s+)?budget|(?:over|above)\s+(?:(?:₦|ngn\s*)(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*(?:million|thousand|[km])\b)?|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:million|thousand|[km]|naira|ngn)\b|\d{1,3}(?:,\d{3})+(?:\.\d+)?(?=\s|$|[.,!?])))/i;

const CONTINUATION_FOLLOW_UP_CUE =
  /\b(?:it|this|that|these|those|one|ones|same|still|instead|cheaper|less|more|better|over-ear|wireless|options?|another|what\s+about|how\s+about)\b/i;

function detectProductTopicGroup(text: string): string | undefined {
  if (
    /\b(?:smartphones?|phones?|iphones?|pixels?|galaxy\w*|redmi|tecno|infinix)\b/i.test(
      text
    )
  ) {
    return 'phone';
  }
  if (
    /\b(?:laptops?|macbooks?|notebooks?|thinkpad\w*|ultrabooks?)\b/i.test(text)
  ) {
    return 'laptop';
  }
  if (/\b(?:tablets?|ipads?)\b/i.test(text)) {
    return 'tablet';
  }
  if (/\bcameras?\b/i.test(text)) {
    return 'camera';
  }
  if (
    /\b(?:headphones?|headsets?|earbuds?|earphones?|airpods|speakers?|audio)\b/i.test(
      text
    )
  ) {
    return 'audio';
  }
  if (/\b(?:consoles?|ps4|ps5|playstation|xbox|nintendo)\b/i.test(text)) {
    return 'gaming';
  }
  if (/\b(?:smartwatches?|watches)\b/i.test(text)) {
    return 'watch';
  }
  if (/\b(?:televisions?|tvs?|monitors?)\b/i.test(text)) {
    return 'display';
  }
  if (
    /\b(?:chargers?|cables?|adapters?|cases?|power[\s-]*banks?)\b/i.test(text)
  ) {
    return 'accessory';
  }
  return undefined;
}

export function resolveConversationBudgetLimit(
  messages: CatalogChatMessage[],
  currencyCode: string
): CatalogBudgetLimit | undefined {
  const userMessages = messages.filter((message) => message.role === 'user');
  const latestUser = userMessages.at(-1);
  if (!latestUser) return undefined;

  const latestBudget = analyzeFastCatalogBudget(
    latestUser.content,
    currencyCode
  );
  if (latestBudget.hasBudget && !latestBudget.invalid && latestBudget.price) {
    return latestBudget.price;
  }

  if (BUDGET_OVERRIDE_CUE.test(latestUser.content)) {
    return undefined;
  }

  const latestGroup = detectProductTopicGroup(latestUser.content);
  const hasContinuationCue = CONTINUATION_FOLLOW_UP_CUE.test(
    latestUser.content
  );

  for (let i = userMessages.length - 2; i >= 0; i -= 1) {
    const priorContent = userMessages[i].content;
    const budget = analyzeFastCatalogBudget(priorContent, currencyCode);
    if (!budget.hasBudget) continue;
    if (budget.invalid || !budget.price) continue;

    const priorGroup = detectProductTopicGroup(priorContent);
    if (latestGroup && priorGroup && latestGroup !== priorGroup) {
      return undefined;
    }

    if (
      latestBudget.hasBudget ||
      hasContinuationCue ||
      (latestGroup && latestGroup === priorGroup)
    ) {
      return budget.price;
    }

    return undefined;
  }

  return undefined;
}

export function isProductWithinBudget(
  price: unknown,
  budget: CatalogBudgetLimit | undefined
): boolean {
  if (!budget) return true;
  if (typeof price !== 'number' || !Number.isFinite(price)) return false;
  return budget.exclusive ? price < budget.amount : price <= budget.amount;
}

export function constrainSearchParamsWithBudget<
  T extends { maxPrice?: number; minPrice?: number },
>(params: T, budget: CatalogBudgetLimit | undefined): T {
  if (!budget) return params;
  const maxPrice =
    typeof params.maxPrice === 'number' && Number.isFinite(params.maxPrice)
      ? Math.min(params.maxPrice, budget.amount)
      : budget.amount;

  // Keep any caller/model minPrice intact instead of widening downward when
  // minPrice > maxPrice so contradictory ranges fail closed as empty results.
  return {
    ...params,
    maxPrice,
  };
}

export function filterToolResultByBudget(
  toolName: string,
  result: unknown,
  budget: CatalogBudgetLimit | undefined
): unknown {
  if (!budget || typeof result !== 'object' || result === null) {
    return result;
  }

  if (toolName === 'searchProducts') {
    const record = result as { products?: unknown; total?: unknown };
    if (!Array.isArray(record.products)) return result;
    const filteredProducts = record.products.filter((item) => {
      if (typeof item !== 'object' || item === null) return false;
      return isProductWithinBudget((item as { price?: unknown }).price, budget);
    });
    return {
      ...record,
      products: filteredProducts,
      total: filteredProducts.length,
    };
  }

  if (toolName === 'getProductDetails') {
    const record = result as { error?: unknown; price?: unknown };
    if (typeof record.error === 'string' && record.price === undefined) {
      return result;
    }
    if (!isProductWithinBudget(record.price, budget)) {
      return null;
    }
  }

  return result;
}

export function filterSerializedSearchResultByBudget(
  rawJson: string,
  budget: CatalogBudgetLimit | undefined
): string {
  if (!budget) return rawJson;
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    const filtered = filterToolResultByBudget('searchProducts', parsed, budget);
    return JSON.stringify(filtered);
  } catch {
    return JSON.stringify({ products: [], total: 0 });
  }
}

export function filterSerializedDetailsResultByBudget(
  rawJson: string,
  budget: CatalogBudgetLimit | undefined
): string {
  if (!budget) return rawJson;
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    const filtered = filterToolResultByBudget(
      'getProductDetails',
      parsed,
      budget
    );
    if (filtered === null) {
      return JSON.stringify({ available: false });
    }
    return rawJson;
  } catch {
    return JSON.stringify({ available: false });
  }
}
