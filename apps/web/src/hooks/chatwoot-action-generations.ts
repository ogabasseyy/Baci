/**
 * Tracks which inline actions are still current. Cart actions supersede one
 * another (the newest wins). Product lookups are read-only and keyed by their
 * own request id, so they stay current until the conversation or session
 * context is replaced, even while other lookups or cart actions run.
 */
export function createChatwootActionGenerations() {
  let latest = 0;
  let context = 0;
  let latestRenewed = 0;
  return {
    beginContext() {
      context += 1;
      latest += 1;
    },
    startAction(independent: boolean) {
      const startedContext = context;
      const generation = independent ? latest : ++latest;
      return {
        /**
         * Session renewal is context state, not reply state: a superseded
         * action still rotated the browser proof, so a queued retry must see
         * it. Only a renewal from a newer-or-equal action replaces an applied
         * one, so a late older response cannot roll the token back.
         */
        canApplyRenewal: () => {
          if (generation < latestRenewed) return false;
          latestRenewed = generation;
          return true;
        },
        isCurrent: () =>
          independent ? context === startedContext : generation === latest,
      };
    },
  };
}
