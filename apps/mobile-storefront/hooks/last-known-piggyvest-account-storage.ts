import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WalletFundingAccount, WalletQueryData } from './wallet-query';

const KEY_PREFIX = 'baci.wallet.last-piggyvest-account.v1';

function storageKey(merchantId: string, userId: string): string {
  return `${KEY_PREFIX}:${merchantId}:${userId}`;
}

function isPiggyvestAccount(value: unknown): value is WalletFundingAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as Record<string, unknown>;
  return (
    account.provider === 'piggyvest' &&
    typeof account.account_number === 'string' &&
    account.account_number.length > 0 &&
    typeof account.account_name === 'string' &&
    typeof account.bank_name === 'string'
  );
}

/**
 * The PiggyVest account number from this customer's last confirmed wallet
 * load at this store, kept on the device so a cold launch with the server
 * unreachable still shows it (walk 14). Scoped to merchant and signed-in
 * user, like the cached balance; an account number isn't secret to its
 * owner. Unreadable storage reads as "none".
 */
export async function readLastKnownPiggyvestAccount(
  merchantId: string,
  userId: string
): Promise<WalletFundingAccount | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(merchantId, userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPiggyvestAccount(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Saves a confirmed PiggyVest account, or forgets it once a fresh read says
 * there is none; a failed read (primary_unavailable) changes nothing.
 * Storage failures never fail the wallet load.
 */
export async function syncLastKnownPiggyvestAccount(
  merchantId: string,
  userId: string,
  loaded: WalletQueryData
): Promise<void> {
  if (loaded.wallet.primary_unavailable === true) return;
  const account = loaded.wallet.funding_account;
  try {
    if (isPiggyvestAccount(account)) {
      await AsyncStorage.setItem(
        storageKey(merchantId, userId),
        JSON.stringify({
          account_name: account.account_name,
          account_number: account.account_number,
          bank_name: account.bank_name,
          provider: account.provider,
        })
      );
    } else {
      await AsyncStorage.removeItem(storageKey(merchantId, userId));
    }
  } catch {
    // The next confirmed load saves it again.
  }
}
