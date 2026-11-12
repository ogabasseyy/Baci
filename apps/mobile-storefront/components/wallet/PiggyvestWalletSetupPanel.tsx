import Ionicons from '@react-native-vector-icons/ionicons';
// useEffectEvent is stable React since 19.2; this app pins react 19.3.0.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import {
  beginPrimaryRead,
  rememberPrimaryFundingAccount,
} from '@/hooks/primary-funding-account-memory';
import { isPrimaryWalletReviewRequired } from '@/lib/piggyvest-primary-capability';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import { PiggyvestWalletSetupForm } from './PiggyvestWalletSetupForm';
import { PrimaryWalletSetupPending } from './PrimaryWalletSetupPending';

const AUTO_CHECK_INTERVAL_MS = 5000;
const AUTO_CHECK_LIMIT = 12;

import {
  WalletFundPhonePrompt,
  type WalletFundPhoneSubmitResult,
} from './WalletFundPhonePrompt';

interface Props {
  colors: (typeof Colors)['light'];
  merchantId: string;
  needsPhone: boolean;
  onSubmitPhone: (phone: string) => Promise<WalletFundPhoneSubmitResult>;
  onRefresh: () => void;
  onClose: () => void;
}

export function PiggyvestWalletSetupPanel({
  colors,
  merchantId,
  needsPhone,
  onSubmitPhone,
  onRefresh,
  onClose,
}: Props) {
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [awaitingAccount, setAwaitingAccount] = useState(false);
  const [autoChecks, setAutoChecks] = useState(0);
  const [reviewScope, setReviewScope] = useState<{
    userId: string;
    merchantId: string;
  } | null>(null);
  // Account binding: every input and flow state below belongs to whoever
  // is signed in. The panel is merchant-keyed by its parent, so without
  // this an account switch would leave A's retained BVN submittable under
  // B's session. Remount inputs per account (key below), reset flow state
  // on change, and ignore in-flight results from a previous account.
  const authUserId = useAuthStore((state) => state.user?.id ?? null);
  const reviewRequired =
    reviewScope?.userId === authUserId && reviewScope.merchantId === merchantId;
  const authUserIdRef = useRef(authUserId);
  authUserIdRef.current = authUserId;
  const previousAuthUserIdRef = useRef(authUserId);
  useEffect(() => {
    if (previousAuthUserIdRef.current === authUserId) return;
    previousAuthUserIdRef.current = authUserId;
    setPending(false);
    setBusy(false);
    setError(false);
    setAwaitingAccount(false);
    setAutoChecks(0);
    setReviewScope(null);
  }, [authUserId]);

  useEffect(() => {
    if (!authUserId) return;
    const requestUserId = authUserId;
    let active = true;
    void piggyvestPrimaryWalletApi
      .read(merchantId, requestUserId)
      .catch((error: unknown) => {
        if (
          active &&
          authUserIdRef.current === requestUserId &&
          isPrimaryWalletReviewRequired(error)
        ) {
          setReviewScope({ userId: requestUserId, merchantId });
        }
      });
    return () => {
      active = false;
    };
  }, [authUserId, merchantId]);

  async function refresh() {
    if (busy) return;
    const requestUserId = authUserIdRef.current;
    setBusy(true);
    setError(false);
    setAwaitingAccount(false);
    // Numbered as it starts, so a wallet read started later still wins.
    const sequence = requestUserId
      ? beginPrimaryRead(merchantId, requestUserId)
      : 0;
    try {
      const result = await piggyvestPrimaryWalletApi.read(
        merchantId,
        requestUserId ?? undefined
      );
      if (authUserIdRef.current !== requestUserId) return;
      if (result.account) {
        // Hand this confirmed read to the wallet reload below, so the sheet
        // closes even when that reload's own PiggyVest read runs slow.
        // Only a full read (account and balance) is handed over: one
        // without a balance would show the account but not the money.
        const balanceKobo = result.balanceKobo;
        if (
          requestUserId &&
          typeof balanceKobo === 'number' &&
          Number.isSafeInteger(balanceKobo) &&
          balanceKobo >= 0
        )
          rememberPrimaryFundingAccount(
            merchantId,
            requestUserId,
            {
              status: 'ready',
              account: result.account,
              balanceKobo,
            },
            sequence
          );
        // Reload even when a newer read already answered (the handover is
        // then ignored): that newer answer is what the reload recalls, and
        // the reload is what closes this sheet.
        onRefresh();
      } else setAwaitingAccount(true);
    } catch (error) {
      if (authUserIdRef.current !== requestUserId) return;
      if (requestUserId && isPrimaryWalletReviewRequired(error)) {
        setReviewScope({ userId: requestUserId, merchantId });
      } else {
        setError(true);
      }
    } finally {
      if (authUserIdRef.current === requestUserId) setBusy(false);
    }
  }

  // While PiggyVest finishes the account number, check by itself every few
  // seconds (bounded) so the customer never has to keep tapping.
  const runAutoCheck = useEffectEvent(() => {
    // A manual check may have started since the timer was set: skip without
    // spending one of the bounded automatic checks.
    if (busy) return;
    setAutoChecks((count) => count + 1);
    void refresh();
  });
  useEffect(() => {
    // Wait while a check is in flight so every counted check really runs.
    if (busy || !pending || reviewRequired || autoChecks >= AUTO_CHECK_LIMIT)
      return;
    const timer = setTimeout(runAutoCheck, AUTO_CHECK_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [busy, pending, reviewRequired, autoChecks]);

  return (
    <View style={{ padding: 24, gap: 20 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close add money"
        hitSlop={8}
        onPress={onClose}
        style={{
          alignSelf: 'flex-end',
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.muted,
          marginBottom: -12,
        }}
      >
        <Ionicons name="close" size={18} color={colors.text} />
      </Pressable>
      {reviewRequired ? (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          Your PiggyVest wallet setup needs review. Please contact support
          before trying again.
        </Text>
      ) : needsPhone ? (
        <WalletFundPhonePrompt
          key={authUserId ?? 'signed-out'}
          colors={colors}
          onSubmit={onSubmitPhone}
        />
      ) : pending ? (
        <PrimaryWalletSetupPending
          colors={colors}
          checking={busy}
          stillWaiting={
            awaitingAccount && autoChecks >= AUTO_CHECK_LIMIT && !busy
          }
          checkFailed={error}
          onCheckNow={refresh}
        />
      ) : (
        <PiggyvestWalletSetupForm
          key={authUserId ?? 'signed-out'}
          colors={colors}
          merchantId={merchantId}
          onSubmit={async (input) => {
            // Flip pending only once creation succeeds without an
            // account yet: flipping first would unmount the form and
            // wipe its BVN on every failure (even a catch-side reset
            // remounts fresh state). A rejection propagates so the
            // still-mounted form keeps its input and shows its error
            // for correction and resubmission.
            const requestUserId = authUserIdRef.current;
            // Bound before sending: the client authenticates with the
            // token it read for this user (or throws), so a switch
            // mid-flight cannot onboard the new account with the
            // previous account's BVN.
            let result: Awaited<
              ReturnType<typeof piggyvestPrimaryWalletApi.create>
            >;
            try {
              result = await piggyvestPrimaryWalletApi.create(
                input,
                requestUserId ?? undefined
              );
            } catch (error) {
              if (authUserIdRef.current !== requestUserId) return;
              if (requestUserId && isPrimaryWalletReviewRequired(error)) {
                setReviewScope({ userId: requestUserId, merchantId });
                return;
              }
              throw error;
            }
            // Switched mid-flight: the input belonged to the previous
            // account, so never apply its outcome to the new one.
            if (authUserIdRef.current !== requestUserId) return;
            if (result.account) onRefresh();
            else setPending(true);
          }}
        />
      )}
      <View
        accessible
        accessibilityLabel="Secured by PiggyVest"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <Ionicons name="lock-closed" size={12} color={colors.textSecondary} />
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          Secured by
        </Text>
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
          PiggyVest
        </Text>
      </View>
    </View>
  );
}
