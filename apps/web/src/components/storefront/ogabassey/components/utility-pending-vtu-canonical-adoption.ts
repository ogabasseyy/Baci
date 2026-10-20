/**
 * Durable canonical-key adoption for intent-claim joins (web).
 *
 * Split from utility-pending-idempotency.ts per the 300-line
 * module-size budget (Codex R1 P1 fix; mobile mirror in
 * pending-vtu-canonical-adoption.ts).
 */
import { parsePendingVtuSnapshot } from './utility-pending-vtu-codec';
import {
  loadPendingVtuSnapshot,
  runPendingVtuMintLocked,
} from './utility-pending-idempotency-store';
import {
  pendingVtuPurchases,
  persistPendingVtuPurchases,
  schedulePendingVtuFlush,
} from './utility-pending-vtu-sync';

/** Rebinds a minted entry to the server's canonical (winner) key
 * after an intent-claim join, preserving reference/scopeTag/
 * completion — DURABLY (Codex R1 P1, mobile mirror): the rebind
 * is flushed under the mint mutex before resolving, so a restart
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
  payloadSignature: string,
  expectedKey: string,
  key: string
): Promise<boolean> {
  const entry = pendingVtuPurchases.get(payloadSignature);
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
          ([scoped]) => scoped === payloadSignature
        );
        if (
          persisted &&
          persisted[1].key !== expectedKey &&
          persisted[1].rememberedAt >= entry.rememberedAt
        ) {
          // Stale veto — but reconcile memory to the persisted
          // newer generation first (Codex P1): leaving the
          // superseded K1 live lets a later memory-wins flush
          // write K1 back over K2. No flush here: memory now
          // matches storage, nothing to write.
          pendingVtuPurchases.set(payloadSignature, {
            ...persisted[1],
            completedAt: persisted[1].completedAt ?? null,
          });
          return 'stale' as const;
        }
        const live = pendingVtuPurchases.get(payloadSignature);
        if (!live || (live.key !== expectedKey && live.key !== key)) {
          // Forgotten or rotated while waiting for the lock: never
          // resurrect, never overwrite a newer generation.
          return 'stale' as const;
        }
        if (live.key === expectedKey) {
          // Loser key still live: rebind to the canonical winner.
          pendingVtuPurchases.set(payloadSignature, { ...live, key });
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
