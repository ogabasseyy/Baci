import {
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { piggyvestPayingBalanceKobo } from '@/components/wallet-pay/piggyvest-wallet-covers';
import { startWithReplayCaution } from '@/components/wallet-pay/replay-start-caution';
import { useWalletPaySheet } from '@/components/wallet-pay/use-wallet-pay-sheet';
import type { WalletPayAdapter } from '@/components/wallet-pay/wallet-pay.types';
import {
  trackWalletPayPurchase,
  walletPayPurchaseKeys,
} from '@/components/wallet-pay/wallet-pay-purchase-keys';
import { CONFIG } from '@/lib/config';
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
  // Even mid-payment: closing drops this sheet's answers (the request
  // itself settles on the server and the key stays with account A).
  const closeForSwitch = useEffectEvent(() => {
    if (sheet.step !== 'closed') sheet.close();
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
    /** What the form shows and asks about paying from PiggyVest. */
    view: {
      covers: (tier: ImeiServiceTierKey) =>
        imeiWalletPayCovers({ canPay, wallet, tier, refusedTiers }),
      savingsKobo:
        walletQuery.isRefetching === true
          ? null
          : piggyvestPayingBalanceKobo({ canPay, wallet }),
    },
    open: async (tier: ImeiServiceTierKey, imei: string) => {
      // The build's merchant, never the hydrated one: that can still be
      // null at startup, and the key must match after a restart.
      const { user } = useAuthStore.getState();
      const merchantId = CONFIG.MERCHANT_ID;
      let purchase: string | null = null;
      let inner: WalletPayAdapter<ImeiWalletPayResult> | null = null;
      // The key is read inside the start, so a phone that can't read its
      // saved keys shows "Try again" instead of paying with a new key.
      const lazy: WalletPayAdapter<ImeiWalletPayResult> = {
        async start() {
          // Signed out: nothing to resume, so no shared key is ever saved.
          if (!user?.id)
            return { kind: 'outcome', outcome: { kind: 'sign_in' } } as const;
          // One key per purchase (per account) until it settles, kept across
          // restarts. The IMEI is hashed so the saved purchase doesn't show
          // it in plain text. The hash is an identifier, not a secret (an
          // IMEI can be brute-forced); the app's own storage is the boundary.
          const imeiHash = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            // One device, one key, however it was typed (spaces, case).
            imei.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
          );
          purchase = `imei|${user?.id ?? ''}|${merchantId ?? ''}|${device}|${tier}|${imeiHash}`;
          // Minted now = a new purchase; reused = a replay of an earlier
          // attempt whose payment may already have gone through.
          let minted = false;
          const idempotencyKey = await walletPayPurchaseKeys.keyFor(
            purchase,
            () => {
              minted = true;
              return Crypto.randomUUID();
            }
          );
          // The account may have changed during the awaits above: never send
          // the new account's token with the old account's key.
          if (useAuthStore.getState().user?.id !== user.id)
            return { kind: 'outcome', outcome: { kind: 'sign_in' } } as const;
          inner = createImeiWalletPayAdapter({
            // The live token on every call: a refresh while the sheet is
            // open must not leave PIN checks and re-checks on an old one.
            connection: {
              apiBaseUrl,
              accessToken: () =>
                useAuthStore.getState().session?.access_token ?? accessToken,
            },
            device,
            tier,
            imei,
            idempotencyKey,
            onTierRefused: () =>
              setRefusedTiers((tiers) =>
                tiers.includes(tier) ? tiers : [...tiers, tier]
              ),
          });
          const started = inner;
          return await startWithReplayCaution(!minted, () => started.start());
        },
        verifyPin: async (operationId, pin) => {
          if (!inner) throw new Error('Wallet payment not started');
          return await inner.verifyPin(operationId, pin);
        },
        pay: async (operationId, proof) => {
          if (!inner) throw new Error('Wallet payment not started');
          return await inner.pay(operationId, proof);
        },
      };
      // Settled purchases may have moved money: show the new balance. The
      // whole payment is bound to the account that opened it.
      await sheet.open(
        trackWalletPayPurchase(lazy, () => purchase, {
          onSettled: () => void walletQuery.refetch?.(),
          stillOwner: () => useAuthStore.getState().user?.id === user?.id,
          stillWanted: sheet.nextSession(),
        })
      );
    },
  };
}
