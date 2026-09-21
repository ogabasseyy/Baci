// Generations minted by this build (codepoint sort era). Restored legacy IDs
// are never registered, so re-persisting them cannot mark them as sorted.
const mintedCheckoutGenerations = new Set<string>();

export function registerMintedCheckoutGeneration(
  checkoutGeneration: string
): string {
  mintedCheckoutGenerations.add(checkoutGeneration);
  return checkoutGeneration;
}

export function isMintedCheckoutGeneration(
  checkoutGeneration: string
): boolean {
  return mintedCheckoutGenerations.has(checkoutGeneration);
}
