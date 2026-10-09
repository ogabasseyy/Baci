import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
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

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError(false);
    setAwaitingAccount(false);
    try {
      const result = await piggyvestPrimaryWalletApi.read(merchantId);
      if (result.account) onRefresh();
      else setAwaitingAccount(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
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
        <WalletFundPhonePrompt colors={colors} onSubmit={onSubmitPhone} />
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
          colors={colors}
          merchantId={merchantId}
          onSubmit={async (input) => {
            // Flip pending only once creation succeeds without an
            // account yet: flipping first would unmount the form and
            // wipe its BVN on every failure (even a catch-side reset
            // remounts fresh state). A rejection propagates so the
            // still-mounted form keeps its input and shows its error
            // for correction and resubmission.
            const result = await piggyvestPrimaryWalletApi.create(input);
            if (result.account) onRefresh();
            else setPending(true);
          }}
        />
      )}
      <Text style={{ color: colors.textSecondary }}>Powered by PiggyVest</Text>
    </View>
  );
}
