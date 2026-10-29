const MAX_CONTEXT_MESSAGES = 6;

/** Keep only contiguous customer refinements attached to the nearest search. */
export function resolveCatalogContext(
  messages: string[],
  options: {
    isShopping: (text: string) => boolean;
    isPriceFollowUp: (text: string) => boolean;
    isRefinement: (text: string) => boolean;
    isBoundary: (text: string) => boolean;
    isCompleteSearch?: (text: string) => boolean;
    getContinuationRequest?: (text: string) => {
      refinement?: string;
      requiresFreshSearch?: boolean;
    } | null;
  }
): {
  text: string;
  priceFollowUp: boolean;
  requiresFreshSearch?: boolean;
} | null {
  const latest = messages.at(-1)?.trim() ?? '';
  if (!latest || options.isBoundary(latest)) return null;
  const priceFollowUp = options.isPriceFollowUp(latest);
  const continuation = options.getContinuationRequest?.(latest) ?? null;
  const windowStart = Math.max(0, messages.length - MAX_CONTEXT_MESSAGES);
  const hasPendingFreshSearchBefore = (endIndex: number): boolean => {
    for (let index = endIndex - 1; index >= windowStart; index--) {
      const previous = messages[index].trim();
      if (!previous || options.isBoundary(previous)) return false;
      const prior = options.getContinuationRequest?.(previous);
      if (prior?.requiresFreshSearch) return true;
      if (prior) continue;
      if (options.isPriceFollowUp(previous)) continue;
      if (options.isShopping(previous)) {
        if (options.isCompleteSearch?.(previous)) return false;
        continue;
      }
      if (!options.isRefinement(previous)) return false;
    }
    return false;
  };
  if (!priceFollowUp && !continuation && options.isShopping(latest)) {
    const requiresFreshSearch =
      hasPendingFreshSearchBefore(messages.length - 1) &&
      !options.isCompleteSearch?.(latest);
    return { text: latest, priceFollowUp: false, requiresFreshSearch };
  }
  if (!priceFollowUp && !continuation && !options.isRefinement(latest))
    return null;

  const refinements = priceFollowUp
    ? []
    : continuation?.refinement
      ? [continuation.refinement]
      : continuation
        ? []
        : [latest];
  let requiresFreshSearch = continuation?.requiresFreshSearch ?? false;
  for (let index = messages.length - 2; index >= windowStart; index--) {
    const previous = messages[index].trim();
    if (!previous || options.isBoundary(previous)) return null;
    const priorContinuation = options.getContinuationRequest?.(previous);
    if (priorContinuation) {
      if (priorContinuation.refinement)
        refinements.unshift(priorContinuation.refinement);
      if (priorContinuation.requiresFreshSearch) requiresFreshSearch = true;
      continue;
    }
    if (options.isPriceFollowUp(previous)) {
      continue;
    }
    if (options.isShopping(previous)) {
      if (
        hasPendingFreshSearchBefore(index) &&
        !options.isCompleteSearch?.(previous)
      )
        requiresFreshSearch = true;
      return {
        text: [previous, ...refinements].join(' '),
        priceFollowUp,
        requiresFreshSearch,
      };
    }
    if (!options.isRefinement(previous)) return null;
    refinements.unshift(previous);
  }
  return null;
}
