import {
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useWalletPaySheet } from '@/components/wallet-pay/use-wallet-pay-sheet';
import {
  trackWalletPayPurchase,
  walletPayPurchaseKeys,
} from '@/components/wallet-pay/wallet-pay-purchase-keys';
import { SAVINGS_WALLET_CAN_PAY } from '@/lib/savings-wallet-can-pay';
import {
  isWalletStoreCredit,
  type WalletPrimaryLike,
} from '@/lib/wallet-store-credit';
import { useAuthStore } from '@/stores/auth-store';
import {
  createImeiWalletPayAdapter,
  type ImeiWalletPayResult,
} from './imei-wallet-pay-adapter';

type PayingWallet = WalletPrimaryLike & {
  balance?: number;
  /** A remembered PiggyVest balance served when a fresh read failed. */
  primary_stale?: boolean | null;
};

/**
 * True when this check should be paid from the PiggyVest wallet: paying from
 * it is switched on, the tier is one the server can bill to it, the customer
 * is PiggyVest-ready with a fresh balance, store credit can't cover the check
 * and the PiggyVest wallet can. Store credit still pays first whenever it
 * covers the price, exactly as before.
 */
export function imeiWalletPayCovers(input: {
  canPay: boolean;
  wallet: PayingWallet | null | undefined;
  tier: ImeiServiceTierKey;
  refusedTiers?: readonly ImeiServiceTierKey[];
}) {
  const { wallet, tier } = input;
  if (!input.canPay || !wallet || !isWalletStoreCredit(wallet)) return false;
  // Only Sickw-backed checks can be paid this way (server rule).
  if (IMEI_SERVICE_TIERS[tier].providerServiceId === 'petrock-only')
    return false;
  if (input.refusedTiers?.includes(tier)) return false;
  // Only a fresh, settled PiggyVest answer for one known customer counts.
  if (
    wallet.primary_stale === true ||
    wallet.primary_pending === true ||
    wallet.primary_unavailable === true ||
    wallet.owner_unresolved === true
  )
    return false;
  const price = IMEI_SERVICE_TIERS[tier].price;
  const priceKobo = Math.round(price * 100);
  return (
    (wallet.balance ?? 0) < price &&
    (wallet.primary_balance_kobo ?? 0) >= priceKobo
  );
}

/**
 * IMEI check paid from the PiggyVest wallet (dark until
 * SAVINGS_WALLET_CAN_PAY). The screen asks `covers` first and, when true,
 * opens the sheet instead of the store credit top-up.
 */
export function useImeiWalletPay({
  accessToken,
  apiBaseUrl,
  device,
  walletQuery,
  onDelivered,
  canPay = SAVINGS_WALLET_CAN_PAY,
}: {
  accessToken: string | undefined;
  apiBaseUrl: string;
  device: ImeiDeviceCategory;
  walletQuery: {
    data?: { wallet?: PayingWallet | null };
    refetch?: () => unknown;
    isRefetching?: boolean;
  };
  onDelivered: (result: ImeiWalletPayResult) => void;
  /** Tests pass true to preview the switch-on. */
  canPay?: boolean;
}) {
  const sheet = useWalletPaySheet<ImeiWalletPayResult>({ onDelivered });
  const wallet = walletQuery.data?.wallet;
  // A sheet opened for one account never stays open for another.
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const closeForSwitch = useEffectEvent(() => {
    if (sheet.step !== 'closed' && sheet.step !== 'paying') sheet.close();
  });
  const seenUser = useRef(userId);
  useEffect(() => {
    if (seenUser.current === userId) return;
    seenUser.current = userId;
    closeForSwitch();
  }, [userId]);
  const [refusedTiers, setRefusedTiers] = useState<ImeiServiceTierKey[]>([]);
  const leaveTo = (href: '/wallet' | '/auth/login?returnTo=/imei-check') => {
    sheet.close();
    router.push(href);
  };
  const openWallet = () => leaveTo('/wallet');
  const signIn = () => leaveTo('/auth/login?returnTo=/imei-check');
  return {
    sheet,
    /**
     * True while the wallet is being re-read with paying from PiggyVest on:
     * the cached store credit may be out of date, and store credit must pay
     * first whenever it covers the check. Always false while switched off.
     */
    waitsForWallet: canPay && walletQuery.isRefetching === true,
    /** Everything WalletPaySheet needs besides colors. */
    sheetProps: {
      purchase: 'IMEI check',
      sheet,
      onOpenWallet: openWallet,
      onSignIn: signIn,
    },
    covers: (tier: ImeiServiceTierKey) =>
      imeiWalletPayCovers({ canPay, wallet, tier, refusedTiers }),
    open: async (tier: ImeiServiceTierKey, imei: string) => {
      // One key per purchase (per account) until it settles, kept across
      // restarts: a lost, pending or under-review payment is resumed by the
      // next tap, never paid again.
      const { user, merchantId } = useAuthStore.getState();
      const purchase = `imei|${user?.id ?? ''}|${merchantId ?? ''}|${device}|${tier}|${imei}`;
      const idempotencyKey = await walletPayPurchaseKeys.keyFor(
        purchase,
        Crypto.randomUUID
      );
      const adapter = createImeiWalletPayAdapter({
        connection: { apiBaseUrl, accessToken },
        device,
        tier,
        imei,
        idempotencyKey,
        onTierRefused: () =>
          setRefusedTiers((tiers) =>
            tiers.includes(tier) ? tiers : [...tiers, tier]
          ),
      });
      // Settled purchases may have moved money: show the new balance. The
      // whole payment is bound to the account that opened it.
      await sheet.open(
        trackWalletPayPurchase(adapter, purchase, {
          onSettled: () => void walletQuery.refetch?.(),
          stillOwner: () => useAuthStore.getState().user?.id === user?.id,
        })
      );
    },
  };
}
