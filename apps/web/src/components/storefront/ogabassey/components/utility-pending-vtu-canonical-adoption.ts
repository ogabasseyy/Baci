/**
 * Durable canonical-key adoption for intent-claim joins (web).
 *
 * Split from utility-pending-idempotency.ts per the 300-line
 * module-size budget (Codex R1 P1 fix; mobile mirror in
 * pending-vtu-canonical-adoption.ts).
 */
import {
  flushPendingVtuPurchases,
  pendingVtuPurchases,
  schedulePendingVtuFlush,
} from './utility-pending-vtu-sync';

/** Rebinds a minted entry to the server's canonical (winner) key
 * after an intent-claim join, preserving reference/scopeTag/
 * completion — DURABLY (Codex R1 P1, mobile mirror): the rebind
 * is flushed under the mint mutex before resolving, so a restart
 * recovers the winner, not the loser (retrying the loser after
 * the winner terminalizes would prepare fresh and double-debit).
 * No-op true when the entry is missing (forgotten/rotated
 * meanwhile — never resurrect) or already canonical. False =
 * flush failed after retries; a background retry is scheduled
 * and the server-side loser-key mapping backstops the crash
 * window (loser-key retries replay the winner). */
export async function adoptCanonicalVtuKey(
  payloadSignature: string,
  key: string
): Promise<boolean> {
  const entry = pendingVtuPurchases.get(payloadSignature);
  if (!entry || entry.key === key) {
    return true;
  }
  pendingVtuPurchases.set(payloadSignature, { ...entry, key });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (await flushPendingVtuPurchases()) return true;
    } catch {
      break;
    }
  }
  console.error(
    'VTU registry canonical adoption not durable; retry scheduled.'
  );
  schedulePendingVtuFlush();
  return false;
}
