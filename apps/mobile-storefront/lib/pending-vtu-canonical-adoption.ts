/**
 * Durable canonical-key adoption for intent-claim joins.
 *
 * Split from pending-vtu-idempotency.ts per the 300-line
 * module-size gate (Codex R1 P1 fix; web mirror in
 * utility-pending-vtu-canonical-adoption.ts).
 */
import { parsePendingVtuSnapshot } from './pending-vtu-idempotency-codec';
import { loadPendingVtuSnapshot } from './pending-vtu-idempotency-store';
import {
  pendingPurchases,
  persistPendingVtuPurchases,
  runPendingVtuMintLocked,
  schedulePendingVtuFlush,
} from './pending-vtu-idempotency-sync';

/** Rebinds a minted entry to the server's canonical (winner) key
 * after an intent-claim join, preserving reference/scopeTag/
 * completion — DURABLY (Codex R1 P1, web mirror): the rebind is
 * flushed under the mint mutex before resolving, so a restart
 * recovers the winner, not the loser (retrying the loser after
 * the winner terminalizes would prepare fresh and double-debit).
 * Generation-bound (Codex R2 P1): adoption proceeds only when
 * the live entry still holds the expected loser key AND no
 * persisted entry holds a newer different key (a sibling tab's
 * newer generation vetoes — this join response is stale). A
 * stale veto no-ops WITHOUT flushing: memory-wins persistence
 * would otherwise overwrite the newer key, orphaning its retry.
 * No-op true when the entry is missing (forgotten/rotated
 * meanwhile — never resurrect), already canonical, or stale.
 * False = flush failed after retries; a background retry is
 * scheduled and the server-side loser-key mapping backstops the
 * crash window (loser-key retries replay the winner). */
export async function adoptCanonicalVtuKey(
  descriptor: string,
  expectedKey: string,
  key: string
): Promise<boolean> {
  const entry = pendingPurchases.get(descriptor);
  if (!entry || entry.key !== expectedKey || entry.key === key) {
    return true;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const outcome = await runPendingVtuMintLocked(() => {
        // Re-checked under the lock so a sibling persist landing
        // between our pre-check and flush still vetoes. Newer
        // only (rememberedAt): an older persisted key is a lagging
        // write, not a newer generation — overwriting it is
        // correct. Ties veto (fail-closed: the server-side loser
        // mapping covers our retry).
        const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
        const persisted = snapshot.entries.find(
          ([scoped]) => scoped === descriptor
        );
        if (
          persisted &&
          persisted[1].key !== expectedKey &&
          persisted[1].rememberedAt >= entry.rememberedAt
        ) {
          return 'stale' as const;
        }
        const live = pendingPurchases.get(descriptor);
        if (!live || (live.key !== expectedKey && live.key !== key)) {
          // Forgotten or rotated while waiting for the lock: never
          // resurrect, never overwrite a newer generation.
          return 'stale' as const;
        }
        if (live.key === expectedKey) {
          // Loser key still live: rebind to the canonical winner.
          pendingPurchases.set(descriptor, { ...live, key });
        }
        // Already adopted (own retry or a sibling won): skip the
        // rebind but still flush below — the winner must land.
        return persistPendingVtuPurchases()
          ? ('saved' as const)
          : ('failed' as const);
      });
      if (outcome === 'stale' || outcome === 'saved') return true;
      // 'failed' or lock-unacquired (null) → retry.
    } catch {
      // Transient throw → retry the remaining attempts (fall
      // through: bounded loop, a persistent throw still lands in
      // the scheduled-retry path below).
    }
  }
  console.error(
    'VTU registry canonical adoption not durable; retry scheduled.'
  );
  schedulePendingVtuFlush();
  return false;
}
