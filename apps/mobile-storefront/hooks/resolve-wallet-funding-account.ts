import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import {
  getPiggyvestPrimaryCapabilitySnapshot,
  isPrimaryWalletNotReady,
} from '@/lib/piggyvest-primary-capability';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import { parseProjectWalletFundingAccount } from './project-wallet-funding-account';

type PrimarySnapshot = Awaited<
  ReturnType<typeof piggyvestPrimaryWalletApi.read>
>;
export type SettledPrimaryFundingAccount =
  | { status: 'ready'; account: PrimarySnapshot['account'] }
  // Primary definitively has no account for this customer (server
  // unconfigured, or enabled but never provisioned): the legacy
  // projection is authoritative, not stale.
  | { status: 'not_ready' }
  // Unknown (transient failure, parse error, account-switch race):
  // surface no account rather than a possibly superseded legacy DVA.
  | { status: 'unavailable' };

// The funding-account snapshot belongs to whoever the session
// authenticates when the fetch completes — not to the caller that
// started it. The in-flight scope key only partitions the promise map;
// without an identity bind, an account switch mid-flight caches user
// B's bank account under user A's wallet query key.
function readActiveAuthUserId(): string | undefined {
  return useAuthStore.getState().user?.id;
}

function settleBoundAccount(
  expectedUserId: string,
  account: PrimarySnapshot['account'] | undefined
): SettledPrimaryFundingAccount {
  // Post-fetch bind: reject a snapshot that landed after an account
  // switch, even when the session matched at fetch start. Unknown is
  // non-fatal: the wallet still loads and refetches.
  if (readActiveAuthUserId() !== expectedUserId)
    return { status: 'unavailable' };
  // Enabled but never provisioned: the legacy projection is the
  // customer's actual funding path, not a stale fallback.
  if (account === undefined) return { status: 'not_ready' };
  return { status: 'ready', account };
}

/**
 * Starts the primary funding-account lookup. Never throws: callers run it
 * inside the wallet load's Promise.all so a slow provider never serializes
 * the critical path, and every failure settles as unavailable.
 */
export async function readPrimaryFundingAccount(
  merchantId: string,
  userId: string
): Promise<SettledPrimaryFundingAccount> {
  // Pre-fetch bind: refuse to start when the session already disagrees
  // with the expected user (stale closure after a switch, signed out,
  // or a customer-id fallback that is not the auth identity). The
  // wallet load treats unavailable as non-fatal and refetches once the
  // session settles.
  if (readActiveAuthUserId() !== userId) return { status: 'unavailable' };
  if (!isPiggyvestPrimaryMerchant(merchantId)) {
    // Unknown verdict: probe once so a server-enabled merchant resolves
    // its primary account on first load instead of projecting legacy
    // until a manual refetch. Pilot and observed merchants skip the
    // probe; a cached negative answers without network. A fresh probe
    // reuses its own snapshot — the account below is the same read, not
    // a second one. The probe is scoped to (merchant, user): sharing a
    // merchant-wide snapshot promise would leak user A's bank account
    // to user B's wallet load after an account switch.
    try {
      const snapshot = await getPiggyvestPrimaryCapabilitySnapshot(
        merchantId,
        userId
      );
      // The snapshot resolves unavailable only on the server's
      // explicit not-ready signal; anything else rejects.
      if (!snapshot.available) return { status: 'not_ready' };
      if (snapshot.account !== undefined)
        return settleBoundAccount(userId, snapshot.account);
    } catch {
      return { status: 'unavailable' };
    }
  }
  try {
    const { account } = await piggyvestPrimaryWalletApi.read(
      merchantId,
      userId
    );
    return settleBoundAccount(userId, account);
  } catch (error) {
    // Only an authoritative not-ready keeps the legacy projection;
    // transient failures surface unavailable instead of a DVA the
    // primary account may have superseded.
    if (isPrimaryWalletNotReady(error)) return { status: 'not_ready' };
    return { status: 'unavailable' };
  }
}

export function resolveWalletFundingAccount(
  data: unknown,
  primary: SettledPrimaryFundingAccount
) {
  if (primary.status === 'ready' && primary.account)
    return {
      account_name: primary.account.accountName,
      account_number: primary.account.accountNumber,
      bank_name: primary.account.bankName,
      provider: primary.account.provider,
    };
  // The legacy projection answers only an authoritative not_ready
  // (server unconfigured, or enabled but never provisioned): it is the
  // customer's actual funding path there, not a stale fallback. A
  // static merchant allowlist must NOT bypass this — a rolled-out
  // non-pilot merchant whose first probe times out would otherwise
  // project a legacy DVA the primary account may have superseded, and
  // the resolved wallet query never reruns on its own. Unknown
  // (unavailable) surfaces no account; the wallet refetches next load.
  if (primary.status === 'not_ready')
    return parseProjectWalletFundingAccount(data);
  return null;
}
