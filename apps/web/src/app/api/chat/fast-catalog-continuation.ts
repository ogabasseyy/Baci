import { analyzeFastCatalogBudget } from './fast-catalog-budget';
import { hasCatalogProductCue } from './fast-catalog-language';

/** Recognize only complete requests for another set of catalog options. */
export function isCatalogMoreOptionsRequest(text: string): boolean {
  return /^(?:(?:please\s+)?(?:show|give|find)(?:\s+me)?\s+|(?:can|could)\s+you\s+show\s+me\s+|(?:can|could)\s+i\s+see\s+|do\s+you\s+have\s+)?(?:(?:any\s+)?more(?:\s+(?:options?|choices?|ones?|products?))?|(?:any\s+)?other\s+(?:options?|choices?|ones?|products?)|any\s+others?|what\s+else)(?:(?:,\s*|\s+)please)?[?!.\s]*$/i.test(
    text.trim()
  );
}

/** A request for detail does not identify a selected product or new page. */
export function isCatalogDetailFollowUp(text: string): boolean {
  return /^(?:tell|explain)(?:\s+me)?\s+more(?:\s+about\s+(?:it|this|that|them|these|those))?[?!.\s]*$/i.test(
    text.trim()
  );
}

export type CatalogContinuation = {
  kind: 'more-results' | 'product-details';
  refinement?: string;
  requiresFreshSearch?: boolean;
};

/** Defer category-dependent validation until the merchant's categories load. */
export function createCompleteSearchVerifier(options: {
  categoriesLoaded: boolean;
  currencyCode?: string;
  isSearch: (value: string) => boolean;
}) {
  let needsVerification = false;
  return {
    isCompleteSearch(value: string): boolean {
      const budget = analyzeFastCatalogBudget(value, options.currencyCode);
      if (
        !budget.price ||
        budget.invalid ||
        budget.ambiguousCurrency ||
        budget.unsupportedCurrency ||
        !hasCatalogProductCue(value)
      )
        return false;
      if (!options.categoriesLoaded) {
        needsVerification = true;
        return false;
      }
      return options.isSearch(value);
    },
    needsCategoryVerification: () => needsVerification,
  };
}

/** Preserve only supported refinements attached to a more-options request. */
export function parseCatalogContinuation(
  text: string
): CatalogContinuation | null {
  if (isCatalogMoreOptionsRequest(text)) return { kind: 'more-results' };
  if (isCatalogDetailFollowUp(text)) return { kind: 'product-details' };
  const trimmed = text.trim();
  let end = trimmed.length;
  while (end > 0 && /[?!.]/.test(trimmed[end - 1])) end--;
  const match =
    /^(?:(?:please\s+)?(?:show|give|find)(?:\s+me)?\s+|(?:can|could)\s+you\s+show\s+me\s+|(?:can|could)\s+i\s+see\s+|do\s+you\s+have\s+)?more\s+(\S[\s\S]*)$/i.exec(
      trimmed.slice(0, end).trimEnd()
    );
  if (!match) return null;
  const refinement = match[1].replace(
    /^(?:options?|choices?|ones?|products?)\s+/i,
    ''
  );
  const hasOptionWrapper = refinement !== match[1];
  if (
    /^(?:affordable|expensive|than|storage|ram|memory|capacity|like)\b/i.test(
      refinement
    )
  )
    return hasOptionWrapper
      ? { kind: 'more-results', requiresFreshSearch: true }
      : null;
  const startsBudget =
    /^(?:under|below|budget|within|at\s+most|up\s+to|maximum|max|less\s+than)(?=\s|[\d₦$£€]|$)/i.test(
      refinement
    );
  const startsPreference = /^(?:for|with)\s+(?:gaming|camera|battery)\b/i.test(
    refinement
  );
  if (startsBudget || startsPreference) {
    const remainder = analyzeFastCatalogBudget(refinement)
      .searchText.replace(/[?!.]+/g, ' ')
      .trim();
    if (
      !remainder ||
      /^(?:for|with)\s+(?:gaming|camera|battery(?:\s+life)?)$/i.test(remainder)
    )
      return { kind: 'more-results', refinement };
  }
  // A named product or unsupported modifier could switch or add constraints.
  // Ask for a complete new search instead of combining it with an old anchor.
  return { kind: 'more-results', requiresFreshSearch: true };
}
