import { useEffect, useState } from 'react';
import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';

export type PrimaryWalletCardOwnership =
  | 'pending'
  | 'verified'
  | 'blocked'
  | 'mismatch';

// Mount gate for primary wallet card checkouts. Deep-link params are
// caller-controlled: the stamp alone proves nothing, and the reference
// alone does not bind the payment (a caller knowing it could pair it
// with any live Paystack URL). Every primary launch resolves ownership
// from the device record, then peek-polls the operation from the server
// and requires the exact server-issued checkout URL and amount. The
// WebView stays unmounted until both proofs pass (or the launch is
// blocked).
export function usePrimaryWalletCardOwnership({
  enabled,
  authReady,
  userId,
  merchantId,
  reference,
  authorizationUrl,
  amount,
}: {
  enabled: boolean;
  authReady: boolean;
  userId: string | undefined;
  merchantId: string | undefined;
  reference: string | undefined;
  authorizationUrl: string | undefined;
  amount: number | undefined;
}): {
  ownership: PrimaryWalletCardOwnership;
  retryBind: () => void;
} {
  const [ownership, setOwnership] =
    useState<PrimaryWalletCardOwnership>('pending');
  // Mount-bind retry token: re-runs the ownership effect. Safe because
  // the bind below is read-only (peekStatus persists nothing).
  const [bindRetry, setBindRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies(bindRetry): `bindRetry` is an intentional retrigger — the mismatch view bumps it to force a fresh ownership bind.
  useEffect(() => {
    if (!enabled) return;
    // Wait for auth hydration before the lookup: querying with an
    // unresolved user would scope-parse-fail into a 'blocked' flash on
    // a legitimate checkout. The spinner stays up until auth resolves.
    if (!authReady) return;
    // Auth resolved with no signed-in user: no record can be owned.
    if (userId == null) {
      setOwnership('blocked');
      return;
    }
    let cancelled = false;
    setOwnership('pending');
    (async () => {
      const client = createPrimaryWalletCardFundingClient();
      let record: Awaited<ReturnType<typeof client.readPending>>;
      try {
        record = await client.readPending({ merchantId, userId });
      } catch {
        if (!cancelled) setOwnership('blocked');
        return;
      }
      if (
        record == null ||
        record.operationId == null ||
        `pvb-first-primary-${record.operationId}` !== reference
      ) {
        if (!cancelled) setOwnership('blocked');
        return;
      }
      // Server bind: peekStatus() status-polls the record's operation
      // without persisting anything (never re-initializes: operationId
      // is non-null here) and already enforces the record amount. Mount
      // only when the server confirms this exact checkout URL and
      // amount — a stale URL for an advanced operation, a forged URL,
      // a tampered amount, or an unreachable server all fail closed.
      // The WebView needs network regardless, so offline has no
      // legitimate mount; the mismatch view offers a retry for
      // transient network failures.
      try {
        const status = await client.peekStatus({
          merchantId: record.merchantId,
          userId: record.userId,
          reference,
        });
        const bound =
          status.authorizationUrl === authorizationUrl &&
          typeof amount === 'number' &&
          Math.round(amount * 100) === status.amountKobo;
        if (!cancelled) setOwnership(bound ? 'verified' : 'mismatch');
      } catch {
        if (!cancelled) setOwnership('mismatch');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    authReady,
    bindRetry,
    merchantId,
    reference,
    authorizationUrl,
    amount,
    userId,
  ]);
  return { ownership, retryBind: () => setBindRetry((count) => count + 1) };
}
