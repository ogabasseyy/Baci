const MAX_CONTEXT_MESSAGES = 6;

/** Keep only contiguous customer refinements attached to the nearest search. */
export function resolveCatalogContext(
  messages: string[],
  options: {
    isShopping: (text: string) => boolean;
    isPriceFollowUp: (text: string) => boolean;
    isRefinement: (text: string) => boolean;
    isBoundary: (text: string) => boolean;
  }
): { text: string; priceFollowUp: boolean } | null {
  const latest = messages.at(-1)?.trim() ?? '';
  if (!latest || options.isBoundary(latest)) return null;
  const priceFollowUp = options.isPriceFollowUp(latest);
  if (!priceFollowUp && options.isShopping(latest)) {
    return { text: latest, priceFollowUp: false };
  }
  if (!priceFollowUp && !options.isRefinement(latest)) return null;

  const refinements = priceFollowUp ? [] : [latest];
  for (const raw of messages.slice(-MAX_CONTEXT_MESSAGES, -1).reverse()) {
    const previous = raw.trim();
    if (!previous || options.isBoundary(previous)) return null;
    if (options.isPriceFollowUp(previous)) {
      continue;
    }
    if (options.isShopping(previous)) {
      return { text: [previous, ...refinements].join(' '), priceFollowUp };
    }
    if (!options.isRefinement(previous)) return null;
    refinements.unshift(previous);
  }
  return null;
}
