import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useEffectEvent, useRef } from 'react';
import {
  piggyvestPayingBalanceKobo,
  piggyvestWalletCovers,
} from '@/components/wallet-pay/piggyvest-wallet-covers';
import { startWithReplayCaution } from '@/components/wallet-pay/replay-start-caution';
import { useWalletPaySheet } from '@/components/wallet-pay/use-wallet-pay-sheet';
import type { WalletPayAdapter } from '@/components/wallet-pay/wallet-pay.types';
import {
  trackWalletPayPurchase,
  walletPayPurchaseKeys,
} from '@/components/wallet-pay/wallet-pay-purchase-keys';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { useWallet } from '@/hooks/use-wallet';
import { CONFIG } from '@/lib/config';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';
import { SAVINGS_WALLET_CAN_PAY } from '@/lib/savings-wallet-can-pay';
import { vtuWalletPayApi } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { useAuthStore } from '@/stores/auth-store';
import {
  createVtuWalletPayAdapter,
  type VtuWalletPayResult,
} from './vtu-wallet-pay-adapter';
import {
  clearVtuWalletPay,
  useVtuWalletPayStore,
  type VtuWalletPayPending,
} from './vtu-wallet-pay-store';

/**
 * The utilities screen's one PiggyVest pay sheet (dark until
 * SAVINGS_WALLET_CAN_PAY). It tells the forms which amounts the PiggyVest
 * wallet covers and runs the sheet for the purchase a form hands over.
 */
export function useVtuWalletPayHost({
  canPay = SAVINGS_WALLET_CAN_PAY,
}: {
  /** Tests pass true to preview the switch-on. */
  canPay?: boolean;
} = {}) {
  const walletQuery = useWallet();
  const wallet = walletQuery.data?.wallet;
  const refreshing = walletQuery.isRefetching === true;
  const pending = useVtuWalletPayStore((state) => state.pending);
  const deliverTo = useRef<VtuWalletPayPending['onDelivered'] | null>(null);
  const opened = useRef(false);
  const ownerId = useRef<string | null>(null);
  // Set while a payment is issued and no pay request was sent yet.
  const cancelUnpaid = useRef<(() => Promise<void>) | null>(null);
  const sheet = useWalletPaySheet<VtuWalletPayResult>({
    // An answer that lands after the account changed (before the switch
    // closes the sheet) never reaches the new account's screen.
    onDelivered: (result) => {
      if (useAuthStore.getState().user?.id === ownerId.current)
        deliverTo.current?.(result);
    },
  });

  // A stale balance during a refresh never chooses PiggyVest over store credit.
  useEffect(() => {
    const covers = (amount: number) =>
      !refreshing && piggyvestWalletCovers({ canPay, wallet, price: amount });
    useVtuWalletPayStore.setState({
      covers,
      // Shown only while it could pay something (switched on, fresh, ready).
      balanceKobo: refreshing
        ? null
        : piggyvestPayingBalanceKobo({ canPay, wallet }),
    });
  }, [canPay, wallet, refreshing]);
  useEffect(
    () => () => {
      clearVtuWalletPay();
      useVtuWalletPayStore.setState({ covers: () => false, balanceKobo: null });
    },
    []
  );

  const start = useEffectEvent((next: VtuWalletPayPending) => {
    deliverTo.current = next.onDelivered;
    opened.current = true;
    const user = useAuthStore.getState().user;
    ownerId.current = user?.id ?? null;
    // True while this sheet still takes answers (not closed or reopened).
    const wanted = sheet.nextSession();
    let purchase: string | null = null;
    let inner: WalletPayAdapter<VtuWalletPayResult> | null = null;
    const lazy: WalletPayAdapter<VtuWalletPayResult> = {
      async start() {
        // Signed out: nothing to resume, so no shared key is ever saved.
        if (!user?.id)
          return { kind: 'outcome', outcome: { kind: 'sign_in' } } as const;
        // One key per purchase (per account) until it settles, kept across
        // restarts. Hashed: the saved key never holds the phone or meter.
        const descriptor = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          buildVtuPurchaseDescriptor({ ...next.request })
        );
        purchase = `vtu|${user?.id ?? ''}|${CONFIG.MERCHANT_ID}|${descriptor}`;
        // Reused = a replay of an earlier attempt that may have paid.
        let minted = false;
        const idempotencyKey = await walletPayPurchaseKeys.keyFor(
          purchase,
          () => {
            minted = true;
            return Crypto.randomUUID();
          }
        );
        // The account may have changed during the awaits above.
        if (useAuthStore.getState().user?.id !== user.id)
          return { kind: 'outcome', outcome: { kind: 'sign_in' } } as const;
        const connection = {
          apiBaseUrl: EXPO_PUBLIC_API_URL,
          accessToken: () => useAuthStore.getState().session?.access_token,
        };
        const owned = { request: next.request, idempotencyKey };
        inner = createVtuWalletPayAdapter({
          connection,
          ...owned,
          expectedUserId: user.id,
        });
        const started = inner;
        const answer = await startWithReplayCaution(!minted, () =>
          started.start()
        );
        const issuedKey = purchase;
        if (answer.kind === 'pin') {
          const cancel = async () => {
            if (useAuthStore.getState().user?.id !== user.id) return;
            const reply = await vtuWalletPayApi.cancel(connection, {
              ...owned,
              expectedUserId: user.id,
              operationId: answer.operationId,
            });
            // Released and closed: the next attempt starts afresh.
            if (reply.httpStatus === 200 && reply.body.status === 'cancelled')
              await walletPayPurchaseKeys.forget(issuedKey);
          };
          // Closed while the start was out: cancel now (Codex P2).
          if (wanted()) cancelUnpaid.current = cancel;
          else void cancel().catch(() => undefined);
        }
        return answer;
      },
      verifyPin: async (operationId, pin) => {
        if (!inner) throw new Error('Wallet payment not started');
        return await inner.verifyPin(operationId, pin);
      },
      pay: async (operationId, proof) => {
        if (!inner) throw new Error('Wallet payment not started');
        // Money may move from here on: never cancel this payment.
        cancelUnpaid.current = null;
        return await inner.pay(operationId, proof);
      },
    };
    void sheet.open(
      trackWalletPayPurchase(lazy, () => purchase, {
        onSettled: () => void walletQuery.refetch?.(),
        stillOwner: () => useAuthStore.getState().user?.id === user?.id,
        stillWanted: wanted,
      })
    );
  });
  useEffect(() => {
    if (pending) start(pending);
  }, [pending]);

  // The sheet closed: the next purchase may open it again.
  useEffect(() => {
    if (sheet.step === 'closed' && opened.current) {
      opened.current = false;
      clearVtuWalletPay();
      // Closed before any PIN was paid: release the issued payment so the
      // purchase never blocks a later store credit attempt (Codex P2).
      const cancel = cancelUnpaid.current;
      cancelUnpaid.current = null;
      if (cancel) void cancel().catch(() => undefined);
    }
  }, [sheet.step]);

  // A sheet opened for one account never stays open for another.
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const seenUser = useRef(userId);
  const closeForSwitch = useEffectEvent(() => {
    if (sheet.step !== 'closed') sheet.close();
  });
  useEffect(() => {
    if (seenUser.current === userId) return;
    seenUser.current = userId;
    closeForSwitch();
  }, [userId]);

  const leaveTo = (href: '/wallet' | '/auth/login?returnTo=/utilities') => {
    sheet.close();
    router.push(href);
  };
  return {
    sheet,
    sheetProps: {
      purchase: 'purchase',
      sheet,
      onOpenWallet: () => leaveTo('/wallet'),
      onSignIn: () => leaveTo('/auth/login?returnTo=/utilities'),
    },
  };
}
