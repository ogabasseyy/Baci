export interface PairingSyncOperations {
  snapshot: unknown;
  prepare: (() => Promise<void>) | null;
  refresh: (() => Promise<void>) | null;
}
