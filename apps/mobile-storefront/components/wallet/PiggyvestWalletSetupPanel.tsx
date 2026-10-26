import Ionicons from '@react-native-vector-icons/ionicons';
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
  needsPhone: boolean;
  onSubmitPhone: (phone: string) => Promise<WalletFundPhoneSubmitResult>;
  setup?: ReturnType<typeof usePiggyvestWalletSetup>;
  onClose: () => void;
}

export function PiggyvestWalletSetupPanel({
  colors,
  merchantId,
  needsPhone,
  onSubmitPhone,
  setup,
  onClose,
}: Props) {
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
        <WalletFundPhonePrompt colors={colors} onSubmit={onSubmitPhone} />
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
              We’re still checking your account. No deposit has been confirmed
              yet.
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
        <WalletSetupProfileGate colors={colors} merchantId={merchantId}>
          <PiggyvestWalletSetupForm
            colors={colors}
            merchantId={merchantId}
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
