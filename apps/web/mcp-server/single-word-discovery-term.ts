/** Classifies a normalized one-word product query, regardless of surrounding punctuation. */
export function singleWordDiscoveryTerm(query: string | undefined): string | undefined {
  const words = query?.normalize('NFKC').toLocaleLowerCase('en').match(/[a-z0-9]+/g);
  return words?.length === 1 && /^[a-z]{3,}$/.test(words[0]) ? words[0] : undefined;
}
