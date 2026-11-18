import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, withAlpha } from '@/constants/Colors';
import { setupStyles } from './piggyvest-wallet-setup.styles';

type Props = {
  colors: (typeof Colors)['light'];
  /** A check is running right now (manual or automatic). */
  checking: boolean;
  /** Automatic checks ran out without an account number yet. */
  stillWaiting: boolean;
  /** The last check failed to reach the server. */
  checkFailed: boolean;
  /**
   * Offer "Check now": only after the automatic checks run out or a check
   * fails, so the customer normally never has to tap anything.
   */
  canCheckNow: boolean;
  onCheckNow: () => void;
};

/**
 * Shown after the BVN is accepted while PiggyVest finishes creating the
 * account number. The parent checks automatically; this explains the wait
 * and, once those checks run out or one fails, offers a manual check.
 */
export function PrimaryWalletSetupPending({
  colors,
  checking,
  stillWaiting,
  checkFailed,
  canCheckNow,
  onCheckNow,
}: Props) {
  const message = checkFailed
    ? 'We couldn’t reach the wallet service just now. Tap Check now to try again, or close this and come back later.'
    : stillWaiting
      ? 'Your account number is taking longer than usual. Tap Check now when you’re ready, or close this and come back later. If setup asks for your BVN again, re-enter the same number. You won’t get a second wallet.'
      : 'We’ve sent your details and are confirming your bank transfer account. This can take a few minutes. We’ll keep checking, so you don’t need to do anything.';

  return (
    <View style={setupStyles.form} accessibilityLiveRegion="polite">
      <View style={setupStyles.header}>
        <View
          style={[
            setupStyles.headerIcon,
            {
              backgroundColor: checkFailed
                ? withAlpha(colors.warning, 0.14)
                : BRAND.primaryAlpha12,
            },
          ]}
        >
          {stillWaiting || checkFailed ? (
            <Ionicons
              accessible={false}
              importantForAccessibility="no"
              name={checkFailed ? 'cloud-offline-outline' : 'time-outline'}
              size={24}
              color={checkFailed ? colors.warning : BRAND.primary}
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
            color={colors.success}
          />
          <Text style={[setupStyles.benefitText, { color: colors.text }]}>
            Details sent for checking
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
      {canCheckNow ? (
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
      ) : null}
    </View>
  );
}
