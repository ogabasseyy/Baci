import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import { PiggyvestWalletSetupForm } from './PiggyvestWalletSetupForm';
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
  // Account binding: every input and flow state below belongs to whoever
  // is signed in. The panel is merchant-keyed by its parent, so without
  // this an account switch would leave A's retained BVN submittable under
  // B's session. Remount inputs per account (key below), reset flow state
  // on change, and ignore in-flight results from a previous account.
  const authUserId = useAuthStore((state) => state.user?.id ?? null);
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
  }, [authUserId]);

  async function refresh() {
    if (busy) return;
    const requestUserId = authUserIdRef.current;
    setBusy(true);
    setError(false);
    setAwaitingAccount(false);
    try {
      const result = await piggyvestPrimaryWalletApi.read(
        merchantId,
        requestUserId ?? undefined
      );
      if (authUserIdRef.current !== requestUserId) return;
      if (result.account) onRefresh();
      else setAwaitingAccount(true);
    } catch {
      if (authUserIdRef.current !== requestUserId) return;
      setError(true);
    } finally {
      if (authUserIdRef.current === requestUserId) setBusy(false);
    }
  }

  return (
    <View style={{ padding: 24, gap: 20 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close add money"
        onPress={onClose}
      >
        <Text style={{ color: colors.text, textAlign: 'right' }}>Close</Text>
      </Pressable>
      {needsPhone ? (
        <WalletFundPhonePrompt
          key={authUserId ?? 'signed-out'}
          colors={colors}
          onSubmit={onSubmitPhone}
        />
      ) : pending ? (
        <>
          <Text style={{ color: colors.text }}>
            We’re confirming your PiggyVest account. No deposit has been
            confirmed yet.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh PiggyVest account"
            disabled={busy}
            onPress={refresh}
          >
            <Text style={{ color: colors.primary }}>
              {busy ? 'Checking account…' : 'Refresh account'}
            </Text>
          </Pressable>
          {error ? (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              Could not check your account. Please try again later.
            </Text>
          ) : null}
          {awaitingAccount ? (
            <Text style={{ color: colors.textSecondary }}>
              Your account is still being prepared. Check again shortly.
            </Text>
          ) : null}
        </>
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
            const result = await piggyvestPrimaryWalletApi.create(
              input,
              requestUserId ?? undefined
            );
            // Switched mid-flight: the input belonged to the previous
            // account, so never apply its outcome to the new one.
            if (authUserIdRef.current !== requestUserId) return;
            if (result.account) onRefresh();
            else setPending(true);
          }}
        />
      )}
      <Text style={{ color: colors.textSecondary }}>Powered by PiggyVest</Text>
    </View>
  );
}
