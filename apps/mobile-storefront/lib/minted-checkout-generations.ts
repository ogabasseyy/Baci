// Generations minted by this build (codepoint sort era). Restored legacy IDs
// are never registered, so re-persisting them cannot mark them as sorted.
const mintedCheckoutGenerationIds = new Set<string>();

function registerMintedCheckoutGenerationId(
  checkoutGeneration: string
): string {
  mintedCheckoutGenerationIds.add(checkoutGeneration);
  return checkoutGeneration;
}

function isRegisteredMintedCheckoutGeneration(
  checkoutGeneration: string
): boolean {
  return mintedCheckoutGenerationIds.has(checkoutGeneration);
}

export const mintedCheckoutGenerations = {
  isRegistered: isRegisteredMintedCheckoutGeneration,
  register: registerMintedCheckoutGenerationId,
};
