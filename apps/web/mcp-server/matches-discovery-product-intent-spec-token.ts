import { specUnitWords } from './matches-discovery-product-intent-vocab';

/** Join a separated number/unit pair ("16", "gb") into its compact spec form ("16gb").
 * Returns the token itself when it is already compact, or undefined when the
 * token carries no specification. "ram" stays a context word, not a unit. */
export function joinSpecToken(token: string, nextWord: string | undefined): string | undefined {
  if (/^\d+(?:\.\d+)?(?:gb|tb|mb|mah|w|hz|mp|ram)$/.test(token)) return token;
  if (/^\d+(?:\.\d+)?$/.test(token) && nextWord && specUnitWords.has(nextWord)) return `${token}${nextWord}`;
  return undefined;
}
