import {
  readPrimaryFundingAccount,
  type SettledPrimaryFundingAccount,
} from './resolve-wallet-funding-account';

// The primary provider probe may take up to its 30s network timeout;
// the wallet load must never wait that long for one funding rail. A
// stalled probe settles as unknown (surfaced as no account, never a
// possibly superseded legacy DVA) while the rest of the load
// proceeds; the next load refetches.
export const PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS = 5000;

export function readPrimaryFundingAccountSoon(
  merchantId: string,
  userId: string
): Promise<SettledPrimaryFundingAccount> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SettledPrimaryFundingAccount>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: 'unavailable' }),
      PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS
    );
  });
  return Promise.race([
    readPrimaryFundingAccount(merchantId, userId).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    timeout,
  ]);
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
