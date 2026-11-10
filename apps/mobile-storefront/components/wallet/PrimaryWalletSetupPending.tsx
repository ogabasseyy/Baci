import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { setupStyles } from './piggyvest-wallet-setup.styles';

type Props = {
  colors: (typeof Colors)['light'];
  /** A check is running right now (manual or automatic). */
  checking: boolean;
  /** Automatic checks ran out without an account number yet. */
  stillWaiting: boolean;
  /** The last check failed to reach the server. */
  checkFailed: boolean;
  onCheckNow: () => void;
};

/**
 * Shown after the BVN is accepted while PiggyVest finishes creating the
 * account number. The parent checks automatically; this only explains the
 * wait and offers a manual check.
 */
export function PrimaryWalletSetupPending({
  colors,
  checking,
  stillWaiting,
  checkFailed,
  onCheckNow,
}: Props) {
  const message = checkFailed
    ? 'We couldn’t reach PiggyVest just now. Tap Check now to try again, or close this and come back later.'
    : stillWaiting
      ? 'This is taking longer than usual. Tap Check now to try again. If you close this and setup asks for your BVN again, re-enter the same number. You won’t get a second wallet.'
      : 'We’ve sent your details to PiggyVest and are confirming your bank transfer account. This can take a few minutes.';

  return (
    <View style={setupStyles.form} accessibilityLiveRegion="polite">
      <View style={setupStyles.header}>
        <View
          style={[
            setupStyles.headerIcon,
            { backgroundColor: BRAND.primaryAlpha12 },
          ]}
        >
          {stillWaiting || checkFailed ? (
            <Ionicons
              accessible={false}
              importantForAccessibility="no"
              name="time-outline"
              size={24}
              color={BRAND.primary}
            />
          ) : (
            <ActivityIndicator color={BRAND.primary} />
          )}
        </View>
        <Text style={[setupStyles.title, { color: colors.text }]}>
          Setting up your account number
        </Text>
        <Text style={[setupStyles.subtitle, { color: colors.textSecondary }]}>
          {message}
        </Text>
      </View>
      <View style={[setupStyles.benefits, { backgroundColor: colors.muted }]}>
        <View style={setupStyles.benefitRow}>
          <Ionicons
            accessible={false}
            importantForAccessibility="no"
            name="checkmark-circle"
            size={17}
            color="#16A34A"
          />
          <Text style={[setupStyles.benefitText, { color: colors.text }]}>
            Details sent to PiggyVest
          </Text>
        </View>
        <View style={setupStyles.benefitRow}>
          <Ionicons
            accessible={false}
            importantForAccessibility="no"
            name="ellipsis-horizontal-circle"
            size={17}
            color={BRAND.primary}
          />
          <Text style={[setupStyles.benefitText, { color: colors.text }]}>
            Confirming your account number
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check now"
        accessibilityState={{ disabled: checking, busy: checking }}
        disabled={checking}
        onPress={onCheckNow}
        style={[
          setupStyles.submit,
          { backgroundColor: BRAND.primary, opacity: checking ? 0.6 : 1 },
        ]}
      >
        {checking ? (
          <ActivityIndicator color={BRAND.onPrimary} />
        ) : (
          <Text style={[setupStyles.submitText, { color: BRAND.onPrimary }]}>
            Check now
          </Text>
        )}
      </Pressable>
    </View>
  );
}
