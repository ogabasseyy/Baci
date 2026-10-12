/**
 * Per-query next-page fetch locks. State flags (isFetchingNextPage,
 * isLoadingMore) update only after a rerender, so two end-reached signals
 * arriving synchronously would both pass the state guards and start
 * duplicate fetches. Locks are retained per query key until their own
 * request settles: switching queries never clears another key's lock, and
 * a late settlement (query A resolving after the shopper moved to B and
 * back) releases only its own entry. Entries are deleted on release, so
 * the map holds only in-flight requests.
 */
export type NextPageLocks = Map<string, boolean>;

/**
 * Starts a next-page fetch unless one is already in flight for the given
 * query key. The lock releases when the fetch settles, on success or
 * failure.
 */
export function fetchLockedNextPage(
  locks: NextPageLocks,
  key: string,
  fetchNextPage: () => Promise<unknown>
): void {
  if (locks.get(key)) {
    return;
  }
  locks.set(key, true);
  const release = () => {
    locks.delete(key);
  };
  void fetchNextPage().then(release, release);
}
