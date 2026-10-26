/** A committed snapshot channel, not a command or persistence owner. */
export function createCommittedSnapshotStore<T>(initialSnapshot: T) {
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();
  return {
    kind: 'committed-snapshot' as const,
    getSnapshot: () => snapshot,
    // Hydrating consumers must start from the exact server snapshot even when
    // their module finishes loading after background restoration has committed.
    getServerSnapshot: () => initialSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next: T) {
      if (Object.is(snapshot, next)) return;
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

export type CommittedSnapshotStore<T> = ReturnType<
  typeof createCommittedSnapshotStore<T>
>;
