/** Single words that name a use case, place, or budget instead of a product.
 * Marketing descriptions mention these constantly ("perfect for work"), so a
 * description-only mention must not turn an unqualified intent word into a
 * product recommendation. Name, brand, and category matches still count. */
const BROAD_INTENT_DISCOVERY_WORDS = new Set([
  'budget', 'business', 'gaming', 'gift', 'home',
  'office', 'photography', 'school', 'student', 'travel', 'work',
]);

export function isBroadIntentDiscoveryWord(term: string | undefined): boolean {
  if (!term) return false;
  const word = term.toLocaleLowerCase('en');
  return BROAD_INTENT_DISCOVERY_WORDS.has(word) ||
    (word.endsWith('s') && BROAD_INTENT_DISCOVERY_WORDS.has(word.slice(0, -1)));
}
