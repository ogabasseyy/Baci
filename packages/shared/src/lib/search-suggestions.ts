import { normalizeCanonicalProductCondition } from './product-condition';
import { buildProductSearchQuery } from './product-search';
import type { SearchAssistanceProposal } from './shopping-assistance';

export interface SearchSuggestionProduct {
  price: number;
  condition?: string | null;
}
export interface SearchSuggestion {
  label: string;
  proposal: SearchAssistanceProposal;
}
export interface CatalogSearchSuggestionOptions {
  currency?: string;
}

function roundBudgetToMagnitude(value: number): number {
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
}

function formatBudgetAmount(value: number, currency: string): string {
  if (currency === 'NGN') return `₦${value.toLocaleString('en-NG')}`;
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en')}`;
  }
}

/** Suggest only refinements observed in the current query's loaded catalog rows. */
export function buildCatalogSearchSuggestions(
  query: string,
  resultQuery: string,
  products: readonly SearchSuggestionProduct[],
  options?: CatalogSearchSuggestionOptions
): SearchSuggestion[] {
  const term = query.trim();
  const normalized = buildProductSearchQuery(term).normalized;
  if (
    term.length < 2 ||
    term.length > 120 ||
    !normalized ||
    normalized !== buildProductSearchQuery(resultQuery).normalized
  )
    return [];
  const suggestions: SearchSuggestion[] = [];
  for (const condition of ['used', 'new', 'open_box'] as const) {
    // The RPC returns raw matched conditions including catalog aliases
    // (uk_used, refurbished); canonicalize before comparing so aliased
    // rows still surface their Used / Open-box suggestion.
    if (
      !products.some(
        (product) =>
          normalizeCanonicalProductCondition(product.condition) === condition
      )
    )
      continue;
    const prefix =
      condition === 'open_box'
        ? 'Open-box'
        : condition === 'used'
          ? 'Used'
          : 'New';
    suggestions.push({
      label: `${prefix} ${term}`,
      proposal: {
        query: term,
        explanation: 'Refine by condition.',
        filters: { condition },
      },
    });
  }
  const prices = products
    .map((product) => product.price)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  if (prices.length > 1 && prices[0] < prices[prices.length - 1]) {
    const currency = options?.currency?.trim() || 'NGN';
    const median = prices[Math.floor((prices.length - 1) / 2)];
    // Fixed ₦100k steps only fit naira-scale catalogs; other currencies
    // round the median up to its own order of magnitude instead.
    const budget =
      currency === 'NGN'
        ? Math.ceil(median / 100000) * 100000
        : roundBudgetToMagnitude(median);
    if (budget < prices[prices.length - 1]) {
      suggestions.push({
        label: `${term} up to ${formatBudgetAmount(budget, currency)}`,
        proposal: {
          query: term,
          explanation: 'Refine by your budget.',
          filters: { maxPrice: budget },
        },
      });
    }
  }
  return suggestions.slice(0, 4);
}
