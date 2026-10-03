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
/** Suggest only refinements observed in the current query's loaded catalog rows. */
export function buildCatalogSearchSuggestions(
  query: string,
  resultQuery: string,
  products: readonly SearchSuggestionProduct[]
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
    const budget =
      Math.ceil(prices[Math.floor((prices.length - 1) / 2)] / 100000) * 100000;
    if (budget < prices[prices.length - 1]) {
      suggestions.push({
        label: `${term} up to ₦${budget.toLocaleString('en-NG')}`,
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
