import { analyzeFastCatalogBudget } from './fast-catalog-budget';
import {
  isIndependentTopic,
  resolveOgabasseyCommerceContext,
} from './ogabassey-commerce-context';

const REPLACEMENT =
  /\binstead\b|\brather\s+than\b|\b(?:switch|change|swap)\s+to\b|^(?:what|how)\s+about\b/i;
const ABOUT_BUDGET =
  /^(?:what|how)\s+about\s+(?:an?\s+|the\s+|my\s+)?(?:price|cost|budget|under|below|within|up\s+to|at\s+most)\b/i;
const ACKNOWLEDGEMENT =
  /^(?:ok(?:ay)?|yes|yeah|yep|sure|thanks|thank\s+you|got\s+it)[!.\s]*$/i;

function isBudgetOnlyQuestion(text: string): boolean {
  if (!ABOUT_BUDGET.test(text)) return false;
  const budget = analyzeFastCatalogBudget(text);
  const remainder = budget.searchText
    .replace(
      /\b(?:what|how|about|a|an|the|my|price|cost|budget|of|is|instead|please|for)\b/gi,
      ' '
    )
    .replace(/[?!.,;:\s]/g, '');
  return !remainder && (budget.hasBudget || /\b(?:price|cost)\b/i.test(text));
}

export function isCatalogAcknowledgement(text: string): boolean {
  return ACKNOWLEDGEMENT.test(text.trim());
}

/** Remove only a terminal alternative marker before joining user turns. */
export function stripTerminalCatalogAlternative(text: string): string {
  const trimmed = text.trim();
  let end = trimmed.length;
  while (end > 0 && '.!?,;:'.includes(trimmed[end - 1])) end--;
  const candidate = trimmed.slice(0, end).trimEnd();
  const marker = /(?:^|\s)instead(?:,\s*please|\s+please)?$/i.exec(candidate);
  return marker ? candidate.slice(0, marker.index).trimEnd() : trimmed;
}

/** Keep ambiguous replacements pending until the customer supplies a complete search. */
export function hasPendingCatalogAlternative(
  messages: string[],
  options: {
    isShopping: (text: string) => boolean;
    isBoundary: (text: string) => boolean;
    isRefinement: (text: string) => boolean;
    isPriceFollowUp: (text: string) => boolean;
    isCompleteSearch?: (text: string) => boolean;
  }
): boolean {
  let anchored = false;
  let pending = false;
  for (const raw of messages) {
    const text = raw.trim();
    if (
      !text ||
      options.isBoundary(text) ||
      isIndependentTopic(text) ||
      resolveOgabasseyCommerceContext([{ role: 'user', content: text }])
        .explicitPersonal
    ) {
      anchored = false;
      pending = false;
      continue;
    }
    if (anchored && REPLACEMENT.test(text) && !isBudgetOnlyQuestion(text)) {
      pending = !options.isCompleteSearch?.(text);
      continue;
    }
    if (pending) {
      if (options.isCompleteSearch?.(text)) {
        pending = false;
        anchored = true;
      }
      continue;
    }
    if (options.isShopping(text)) anchored = true;
    else if (
      !options.isRefinement(text) &&
      !options.isPriceFollowUp(text) &&
      !isCatalogAcknowledgement(text)
    )
      anchored = false;
  }
  return pending;
}
