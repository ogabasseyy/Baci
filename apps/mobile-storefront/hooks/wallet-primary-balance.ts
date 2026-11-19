import {
  announceLatePrimaryAnswer,
  beginPrimaryRead,
  recallPrimaryFundingAccount,
  rememberPrimaryFundingAccount,
} from './primary-funding-account-memory';
import {
  readPrimaryFundingAccount,
  type SettledPrimaryFundingAccount,
} from './resolve-wallet-funding-account';

// The primary provider probe may take up to its 30s network timeout;
// the wallet load must never wait that long for one funding rail. A
// stalled or failed probe settles as unknown (never a possibly superseded
// legacy DVA) while the rest of the load proceeds. Unknown falls back to
// the last confirmed account read from moments ago (an earlier load, a late
// answer, or the setup sheet's own check), so a slow PiggyVest never shows a
// confirmed customer "Create account number" or a ₦0 balance.
export const PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS = 5000;

export async function readPrimaryFundingAccountSoon(
  merchantId: string,
  userId: string
): Promise<SettledPrimaryFundingAccount> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<SettledPrimaryFundingAccount>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve({ status: 'unavailable' });
    }, PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS);
  });
  // Numbered at start: an answer only counts if no newer read has answered.
  const sequence = beginPrimaryRead(merchantId, userId);
  const read = readPrimaryFundingAccount(merchantId, userId)
    // Settled either way: the budget timer is no longer needed.
    .finally(() => clearTimeout(timer))
    .then((value) => {
      const stored = rememberPrimaryFundingAccount(
        merchantId,
        userId,
        value,
        sequence
      );
      // This load already gave up: tell the screen a confirmed answer landed.
      if (timedOut && stored) announceLatePrimaryAnswer(merchantId, userId);
      return value;
    });
  // Promise.race already handles a read that fails after the budget; the
  // explicit no-op handler just makes that visible.
  read.catch(() => undefined);
  const settled = await Promise.race([read, timeout]);
  if (settled.status !== 'unavailable') return settled;
  const recalled = recallPrimaryFundingAccount(merchantId, userId);
  return recalled ? { ...recalled, recalled: true } : settled;
}

/**
 * Marks a balance recalled from moments ago in place of a fresh read, so the
 * wallet shows it but keeps re-checking until a fresh answer lands.
 */
export function primaryStaleField(primary: SettledPrimaryFundingAccount): {
  primary_stale?: true;
} {
  return primary.status === 'ready' && primary.recalled
    ? { primary_stale: true }
    : {};
}

/** Marks a transient primary read failure, as opposed to an authoritative answer. */
export function primaryUnavailableField(
  primary: SettledPrimaryFundingAccount
): {
  primary_unavailable?: true;
} {
  return primary.status === 'unavailable' ? { primary_unavailable: true } : {};
}

/**
 * The PiggyVest main-wallet balance (kobo) to expose on the wallet, only
 * when the server explicitly says the primary wallet is ready: a confirmed
 * account and a numeric balance. Every other settlement (not ready,
 * unavailable, pending, identity race) adds no field, so the legacy wallet
 * renders exactly as before. Legacy `balance` is never touched here.
 */
export function primaryBalanceField(primary: SettledPrimaryFundingAccount): {
  primary_balance_kobo?: number;
} {
  if (
    primary.status === 'ready' &&
    primary.account !== null &&
    typeof primary.balanceKobo === 'number' &&
    Number.isSafeInteger(primary.balanceKobo) &&
    primary.balanceKobo >= 0
  ) {
    return { primary_balance_kobo: primary.balanceKobo };
  }
  return {};
}
