import { knownBrandWords } from './matches-discovery-product-intent-vocab';
import { matchesWord } from './matches-discovery-product-intent-word-match';
import { type IntentWordScope } from './matches-discovery-product-intent-word-scope';

/** Recognized brands must match the name or brand field, so a competitor
 * mentioned in marketing copy cannot satisfy an explicit brand request.
 * Descriptive modifiers may also match the category or description lead. */
export function matchesIdentityTerms(terms: string[], scope: IntentWordScope): boolean {
  return terms.every((term) =>
    matchesWord(knownBrandWords.has(term) ? scope.identityWords : scope.identityScope, term));
}
