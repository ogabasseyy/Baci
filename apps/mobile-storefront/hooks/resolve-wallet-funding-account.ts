import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { getPiggyvestPrimaryCapabilitySnapshot } from '@/lib/piggyvest-primary-capability';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import {
  parseProjectWalletFundingAccount,
  projectWalletFundingAccount,
} from './project-wallet-funding-account';

type PrimarySnapshot = Awaited<
  ReturnType<typeof piggyvestPrimaryWalletApi.read>
>;
export type SettledPrimaryFundingAccount =
  | { status: 'ready'; account: PrimarySnapshot['account'] }
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
  // switch, even when the session matched at fetch start. Unavailable
  // is non-fatal: the wallet still loads and refetches.
  if (account === undefined || readActiveAuthUserId() !== expectedUserId)
    return { status: 'unavailable' };
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
      if (!snapshot.available) return { status: 'unavailable' };
      if (snapshot.account !== undefined)
        return settleBoundAccount(userId, snapshot.account);
    } catch {
      return { status: 'unavailable' };
    }
  }
  try {
    const { account } = await piggyvestPrimaryWalletApi.read(merchantId);
    return settleBoundAccount(userId, account);
  } catch {
    return { status: 'unavailable' };
  }
}

export function resolveWalletFundingAccount(
  data: unknown,
  merchantId: string,
  primary: SettledPrimaryFundingAccount
) {
  if (!isPiggyvestPrimaryMerchant(merchantId))
    return projectWalletFundingAccount(data, merchantId);
  if (primary.status === 'ready' && primary.account)
    return {
      account_name: primary.account.accountName,
      account_number: primary.account.accountNumber,
      bank_name: primary.account.bankName,
      provider: primary.account.provider,
    };
  // Primary unconfirmed, not yet provisioned, or unreachable: keep the
  // last-known legacy projection instead of discarding the funding
  // section. Freshly onboarded primary customers have no legacy rows, so
  // this still resolves to null for them.
  return parseProjectWalletFundingAccount(data);
}
