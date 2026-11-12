import {
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useRef } from 'react';
import { useWalletPaySheet } from '@/components/wallet-pay/use-wallet-pay-sheet';
import { SAVINGS_WALLET_CAN_PAY } from '@/lib/savings-wallet-can-pay';
import {
  isWalletStoreCredit,
  type WalletPrimaryLike,
} from '@/lib/wallet-store-credit';
import {
  createImeiWalletPayAdapter,
  type ImeiWalletPayResult,
} from './imei-wallet-pay-adapter';

/**
 * True when this check should be paid from the PiggyVest wallet: paying from
 * it is switched on, the customer is PiggyVest-ready, store credit can't
 * cover the check and the PiggyVest wallet can. Store credit still pays
 * first whenever it covers the price, exactly as before.
 */
export function imeiWalletPayCovers(input: {
  canPay: boolean;
  wallet: (WalletPrimaryLike & { balance?: number }) | null | undefined;
  tier: ImeiServiceTierKey;
}) {
  const { wallet } = input;
  if (!input.canPay || !wallet || !isWalletStoreCredit(wallet)) return false;
  const price = IMEI_SERVICE_TIERS[input.tier].price;
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
  wallet,
  onDelivered,
  canPay = SAVINGS_WALLET_CAN_PAY,
}: {
  accessToken: string | undefined;
  apiBaseUrl: string;
  device: ImeiDeviceCategory;
  wallet: (WalletPrimaryLike & { balance?: number }) | null | undefined;
  onDelivered: (result: ImeiWalletPayResult) => void;
  /** Tests pass true to preview the switch-on. */
  canPay?: boolean;
}) {
  const sheet = useWalletPaySheet<ImeiWalletPayResult>({ onDelivered });
  // A start whose answer was lost (network, timeout) retries with the same
  // Idempotency-Key, so the server finds the lookup it may have created
  // instead of opening a second one. Any server answer spends the key.
  const startKey = useRef<{ purchase: string; key: string } | null>(null);
  const keyFor = (purchase: string) => {
    if (startKey.current?.purchase !== purchase)
      startKey.current = { purchase, key: Crypto.randomUUID() };
    return startKey.current.key;
  };
  const leaveTo = (href: '/wallet' | '/auth/login?returnTo=/imei-check') => {
    sheet.close();
    router.push(href);
  };
  const openWallet = () => leaveTo('/wallet');
  const signIn = () => leaveTo('/auth/login?returnTo=/imei-check');
  return {
    sheet,
    /** Everything WalletPaySheet needs besides colors. */
    sheetProps: {
      purchase: 'IMEI check',
      sheet,
      onOpenWallet: openWallet,
      onSignIn: signIn,
    },
    covers: (tier: ImeiServiceTierKey) =>
      imeiWalletPayCovers({ canPay, wallet, tier }),
    open: (tier: ImeiServiceTierKey, imei: string) => {
      const purchase = `${device}|${tier}|${imei}`;
      return sheet.open(
        createImeiWalletPayAdapter({
          connection: { apiBaseUrl, accessToken },
          device,
          tier,
          imei,
          idempotencyKey: keyFor(purchase),
          onStartAnswered: () => {
            if (startKey.current?.purchase === purchase)
              startKey.current = null;
          },
        })
      );
    },
  };
}
