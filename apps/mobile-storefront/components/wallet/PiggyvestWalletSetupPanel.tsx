import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import type { usePiggyvestWalletSetup } from '@/hooks/use-piggyvest-wallet-setup';
import { PiggyvestWalletSetupForm } from './PiggyvestWalletSetupForm';
import { styles } from './piggyvest-wallet-setup.styles';
import {
  WalletFundPhonePrompt,
  type WalletFundPhoneSubmitResult,
} from './WalletFundPhonePrompt';
import { WalletProviderAttribution } from './WalletProviderAttribution';
import { WalletSetupProfileGate } from './WalletSetupProfileGate';

interface Props {
  colors: (typeof Colors)['light'];
  merchantId: string;
  insideBottomSheet?: boolean;
  needsPhone: boolean;
  onSubmitPhone: (phone: string) => Promise<WalletFundPhoneSubmitResult>;
  setup?: ReturnType<typeof usePiggyvestWalletSetup>;
  onClose: () => void;
}

export function PiggyvestWalletSetupPanel({
  colors,
  merchantId,
  insideBottomSheet = false,
  needsPhone,
  onSubmitPhone,
  setup,
  onClose,
}: Props) {
  const [recoveryFormScope, setRecoveryFormScope] = useState<string | null>(
    null
  );
  const showRecoveryForm = recoveryFormScope === setup?.scopeKey;
  const processing = setup?.state === 'processing';
  const checking = !setup || setup.state === 'checking';
  const unavailable = setup?.state === 'unavailable';
  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
            YOUR WALLET
          </Text>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            {processing ? 'Setting up your account' : 'Set up your wallet'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close add money"
          onPress={onClose}
          style={[styles.closeButton, { backgroundColor: colors.muted }]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
      </View>
      {needsPhone ? (
        <WalletFundPhonePrompt
          colors={colors}
          insideBottomSheet={insideBottomSheet}
          onSubmit={onSubmitPhone}
        />
      ) : checking ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Checking account availability"
        >
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Checking account availability…
          </Text>
        </View>
      ) : setup?.reviewRequired ? (
        <Text
          accessibilityRole="alert"
          style={[styles.body, { color: colors.textSecondary }]}
        >
          Your PiggyVest wallet setup needs review. Please contact support
          before trying again.
        </Text>
      ) : processing || unavailable ? (
        <View style={styles.pending}>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {processing
              ? 'Account setup is processing. You can continue using the app.'
              : 'Could not check your account. Please try again.'}
          </Text>
          {setup?.delayed || setup?.hasCheckError ? (
            <Text
              accessibilityRole="alert"
              style={[styles.body, { color: colors.textSecondary }]}
            >
              {setup?.hasCheckError
                ? 'We could not check your account. Try again, or contact support if this continues.'
                : 'We’re still checking your account. If setup does not finish, contact support so we can verify your wallet.'}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh PiggyVest account"
            disabled={setup?.isChecking}
            onPress={setup?.refresh}
          >
            <Text style={{ color: colors.primary }}>
              {setup?.isChecking ? 'Checking account…' : 'Check again'}
            </Text>
          </Pressable>
          {processing && setup?.recoverable ? (
            showRecoveryForm ? (
              <WalletSetupProfileGate
                colors={colors}
                merchantId={merchantId}
                insideBottomSheet={insideBottomSheet}
              >
                <PiggyvestWalletSetupForm
                  key={setup.scopeKey}
                  colors={colors}
                  merchantId={merchantId}
                  insideBottomSheet={insideBottomSheet}
                  onSubmit={setup.recover}
                />
              </WalletSetupProfileGate>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Re-enter BVN to recover wallet setup"
                onPress={() => setRecoveryFormScope(setup?.scopeKey ?? null)}
              >
                <Text style={{ color: colors.primary }}>Try setup again</Text>
              </Pressable>
            )
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={onClose}
            style={[styles.submit, { backgroundColor: colors.primary }]}
          >
            <Text
              style={[styles.submitText, { color: colors.primaryForeground }]}
            >
              Done
            </Text>
          </Pressable>
        </View>
      ) : setup?.state === 'not_started' ? (
        <WalletSetupProfileGate
          colors={colors}
          merchantId={merchantId}
          insideBottomSheet={insideBottomSheet}
        >
          <PiggyvestWalletSetupForm
            key={setup.scopeKey}
            colors={colors}
            merchantId={merchantId}
            insideBottomSheet={insideBottomSheet}
            onSubmit={setup.submit}
          />
        </WalletSetupProfileGate>
      ) : null}
      <View style={[styles.footer, { borderColor: colors.border }]}>
        <WalletProviderAttribution
          provider="piggyvest"
          color={colors.textSecondary}
        />
      </View>
    </View>
  );
}
