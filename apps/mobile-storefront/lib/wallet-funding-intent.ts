import { sanitizeResumableWalletReturnTo } from '@/lib/resumable-wallet-return-to';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { asyncStorage } from '@/lib/storage';

/**
 * Local, single-use record of "the customer opened the wallet funding surface
 * in order to resume <destination>".
 *
 * WHY THIS EXISTS: only CARD top-ups POST to `/wallet/top-up/initialize`, so
 * only they can persist `return_to` into the transaction metadata the webhook
 * reads. A DVA / bank-transfer top-up has no client initialize call at all —
 * the DVA is a standing account number and the transaction row is created by
 * `confirmPaystackWalletDvaTopUp` when the Paystack webhook lands, from
 * customer/provider metadata only. Bank transfer being the primary funding
 * path, the wallet-credited deep link would otherwise resume nothing.
 *
 * The app already knows the destination locally when the customer opens the
 * funding surface, so it is recorded here instead of in the database: no
 * migration (append-only, and a bad one blocks every deploy), no new
 * authenticated endpoint, no extra read on the money path. It degrades safely
 * — a credit landing on a different device simply opens `/wallet`.
 *
 * SAFETY: the value is validated against the strict resumable allowlist on
 * BOTH write and read, is single-use (removed the moment it is read), expires,
 * and is SCOPED TO THE CUSTOMER who created it — a shared device or an account
 * switch inside the TTL must never let one customer's credit resume another
 * customer's interrupted purchase.
 */
export const WALLET_FUNDING_INTENT_STORAGE_KEY =
  '@baci_storefront_wallet_funding_intent';

/** Matches the route-resume TTL: beyond this the "interrupted purchase" is stale. */
export const WALLET_FUNDING_INTENT_TTL_MS = 30 * 60 * 1000;
let fundingIntentOperation = Promise.resolve();

function runFundingIntentOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = fundingIntentOperation.then(operation);
  fundingIntentOperation = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

interface PersistedWalletFundingIntent {
  /** The customer the intent belongs to; only they may consume it. */
  customerId: string;
  returnTo: string;
  savedAt: number;
}

interface StoreWalletFundingIntentInput {
  customerId: string | undefined;
  returnTo: unknown;
}

// All helpers are fail-open, like push-token-storage: a storage failure must
// never break funding or a notification tap. The worst case is landing on
// `/wallet`, which is exactly the pre-existing behaviour.

export function clearWalletFundingIntent(): Promise<boolean> {
  return runFundingIntentOperation(async () => {
    try {
      await asyncStorage.removeItem(WALLET_FUNDING_INTENT_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  });
}

export function readWalletFundingIntentSnapshot(): Promise<string | null> {
  return runFundingIntentOperation(async () => {
    try {
      return await asyncStorage.getItem(WALLET_FUNDING_INTENT_STORAGE_KEY);
    } catch {
      return null;
    }
  });
}

export function clearWalletFundingIntentIfUnchanged(
  snapshot: string | null
): Promise<boolean> {
  return runFundingIntentOperation(async () => {
    try {
      const current = await asyncStorage.getItem(
        WALLET_FUNDING_INTENT_STORAGE_KEY
      );
      if (current !== snapshot) {
        return false;
      }
      if (current !== null) {
        await asyncStorage.removeItem(WALLET_FUNDING_INTENT_STORAGE_KEY);
      }
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Records the destination to resume after the wallet is funded, owned by the
 * customer who opened the funding surface. A value that fails the strict
 * allowlist — or that has no known owner — is never stored, and clears any
 * previous intent, so a hostile, non-resumable or unattributable navigation
 * cannot leave an older (possibly another customer's) intent armed.
 */
export async function storeWalletFundingIntent({
  customerId,
  returnTo: value,
}: StoreWalletFundingIntentInput): Promise<void> {
  const returnTo = sanitizeResumableWalletReturnTo(value);
  if (!(returnTo && customerId)) {
    await clearWalletFundingIntent();
    return;
  }

  try {
    await runFundingIntentOperation(() =>
      asyncStorage.setItem(
        WALLET_FUNDING_INTENT_STORAGE_KEY,
        JSON.stringify({
          customerId,
          returnTo,
          savedAt: Date.now(),
        } satisfies PersistedWalletFundingIntent)
      )
    );
  } catch {
    // Fail-open
  }
}

/**
 * Reads and CLEARS the pending intent (single-use). Returns it only if it
 * belongs to `customerId` (the customer signed in RIGHT NOW), is still within
 * the TTL, and still passes the strict resumable allowlist — the stored value
 * is re-validated on read so an allowlist tightening, or anything that wrote to
 * this key out of band, cannot produce a navigation the current policy would
 * reject.
 *
 * A foreign, ownerless or expired record is CLEARED rather than left armed: on
 * a shared device the previous customer's intent must die at the first credit
 * that looks at it, not linger for the rest of the TTL. Pass the resolved
 * customer id — `undefined` (signed out, or not resolvable) consumes nothing.
 */
export async function consumeWalletFundingIntent(
  customerId: string | undefined,
  shouldConsume: () => boolean = () => true
): Promise<WalletReturnHref | undefined> {
  const raw = await runFundingIntentOperation(async () => {
    try {
      const current = await asyncStorage.getItem(
        WALLET_FUNDING_INTENT_STORAGE_KEY
      );
      if (!shouldConsume()) return null;
      await asyncStorage.removeItem(WALLET_FUNDING_INTENT_STORAGE_KEY);
      if (!shouldConsume() && current !== null) {
        await asyncStorage.setItem(WALLET_FUNDING_INTENT_STORAGE_KEY, current);
        return null;
      }
      return current;
    } catch {
      return null;
    }
  });

  if (!raw) {
    return undefined;
  }

  let parsed: Partial<PersistedWalletFundingIntent>;
  try {
    parsed = JSON.parse(raw) as Partial<PersistedWalletFundingIntent>;
  } catch {
    return undefined;
  }

  // Ownership first: a record written by (or for) anyone other than the
  // currently signed-in customer is never resumable, whatever else it says.
  if (
    !customerId ||
    typeof parsed.customerId !== 'string' ||
    parsed.customerId !== customerId
  ) {
    return undefined;
  }

  if (
    typeof parsed.savedAt !== 'number' ||
    !Number.isFinite(parsed.savedAt) ||
    Date.now() - parsed.savedAt > WALLET_FUNDING_INTENT_TTL_MS ||
    Date.now() < parsed.savedAt
  ) {
    return undefined;
  }

  return sanitizeResumableWalletReturnTo(parsed.returnTo);
}
