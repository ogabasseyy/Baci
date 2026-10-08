/**
 * Deduplicate facet choices by facet identity, keeping the first
 * spelling. Callers pass facet spellings before draft values so the
 * displayed choice resolves to the returned facet spelling.
 */
export function deduplicateFacetChoices(choices: string[]): string[] {
  const byIdentity = new Map<string, string>();
  for (const choice of choices) {
    const identity = choice.trim().toLowerCase();
    if (!byIdentity.has(identity)) byIdentity.set(identity, choice);
  }
  return [...byIdentity.values()];
}
