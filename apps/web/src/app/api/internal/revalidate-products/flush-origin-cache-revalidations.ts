import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import { executeRevalidates } from 'next/dist/server/revalidation-utils';

/**
 * Drains queued Next.js cache tag revalidations inside the active Route Handler
 * before confirmed Cloudflare edge eviction starts. Without this drain,
 * `revalidateTag` only queues work until `resolvePendingRevalidations` runs
 * after `POST` returns, creating a window where an edge miss can refill from
 * stale origin cache.
 */
export async function flushOriginCacheRevalidations(): Promise<void> {
  const workStore = workAsyncStorage.getStore();
  if (!workStore) {
    return;
  }

  const pendingRevalidatedTags = [...(workStore.pendingRevalidatedTags ?? [])];
  const pendingRevalidates = { ...(workStore.pendingRevalidates ?? {}) };
  const pendingRevalidateWrites = [
    ...(workStore.pendingRevalidateWrites ?? []),
  ];

  if (
    pendingRevalidatedTags.length === 0 &&
    Object.keys(pendingRevalidates).length === 0 &&
    pendingRevalidateWrites.length === 0
  ) {
    return;
  }

  const pending = executeRevalidates(workStore, {
    pendingRevalidatedTags,
    pendingRevalidates,
    pendingRevalidateWrites,
  });
  if (pending !== false) {
    await pending;
  }

  if (workStore.pendingRevalidatedTags && pendingRevalidatedTags.length > 0) {
    const drainedTags = new Set(pendingRevalidatedTags);
    workStore.pendingRevalidatedTags = workStore.pendingRevalidatedTags.filter(
      (item) => !drainedTags.has(item)
    );
  }
  if (workStore.pendingRevalidates) {
    for (const key of Object.keys(pendingRevalidates)) {
      if (workStore.pendingRevalidates[key] === pendingRevalidates[key]) {
        delete workStore.pendingRevalidates[key];
      }
    }
  }
  if (workStore.pendingRevalidateWrites && pendingRevalidateWrites.length > 0) {
    const drainedWrites = new Set(pendingRevalidateWrites);
    workStore.pendingRevalidateWrites =
      workStore.pendingRevalidateWrites.filter(
        (item) => !drainedWrites.has(item)
      );
  }
}
