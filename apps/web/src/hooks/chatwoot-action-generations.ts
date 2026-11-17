/**
 * Tracks which inline actions are still current. Cart actions supersede one
 * another (the newest wins). Product lookups are read-only and keyed by their
 * own request id, so they stay current until the conversation or session
 * context is replaced, even while other lookups or cart actions run.
 */
export function createChatwootActionGenerations() {
  let latest = 0;
  let context = 0;
  return {
    beginContext() {
      context += 1;
      latest += 1;
    },
    startAction(independent: boolean) {
      const startedContext = context;
      const generation = independent ? latest : ++latest;
      return {
        isCurrent: () =>
          independent ? context === startedContext : generation === latest,
      };
    },
  };
}
