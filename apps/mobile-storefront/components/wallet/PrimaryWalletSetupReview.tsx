import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { withAlpha } from '@/constants/Colors';
import { setupStyles } from './piggyvest-wallet-setup.styles';

/** The exact sentence support and tests look for. */
export const PRIMARY_WALLET_REVIEW_COPY =
  'Your wallet setup needs review. Please contact support before trying again.';

/**
 * PiggyVest flagged this setup for review. A calm stop, laid out like the
 * other setup steps (icon, title, one line), instead of bare text: there is
 * nothing to retry here, so it offers no button.
 */
export function PrimaryWalletSetupReview({
  colors,
}: {
  colors: (typeof Colors)['light'];
}) {
  return (
    <View style={setupStyles.form} accessibilityLiveRegion="polite">
      <View style={setupStyles.header}>
        <View
          style={[
            setupStyles.headerIcon,
            { backgroundColor: withAlpha(colors.warning, 0.14) },
          ]}
        >
          <Ionicons
            accessible={false}
            importantForAccessibility="no"
            name="shield-checkmark-outline"
            size={24}
            color={colors.warning}
          />
        </View>
        <Text style={[setupStyles.title, { color: colors.text }]}>
          We need to check a few details
        </Text>
        <Text
          accessibilityRole="alert"
          style={[setupStyles.subtitle, { color: colors.textSecondary }]}
        >
          {PRIMARY_WALLET_REVIEW_COPY}
        </Text>
      </View>
    </View>
  );
}
