import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { WalletStatusRow } from '@/components/checkout/WalletStatusRow';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { formatPrice } from '@/stores/cart-store';
import { paymentMethodSelectorStyles as styles } from './styles';
import { getWalletCreditCopy } from './wallet-credit-copy';

type ThemeColors = (typeof Colors)['light'];

interface PaymentMethodStoreCreditRowsProps {
  colors: ThemeColors;
  onSavingsToggle?: () => void;
  onWalletToggle?: () => void;
  savingsAccessibilityLabel: string;
  savingsCoversFully: boolean;
  savingsGoalDisplayName: string;
  savingsIsActive: boolean;
  savingsPortion: number;
  savingsResidualToGateway: number;
  savingsShouldRender: boolean;
  savingsTotalBalance: number;
  /** Order total left for wallet money after savings. */
  walletEffectiveTotal: number;
  walletCoversFully: boolean;
  walletInfoShouldRender: boolean;
  walletIsActive: boolean;
  walletIsStoreCredit?: boolean;
  walletPortion: number;
  walletResidualToCard: number;
  walletShouldRender: boolean;
  walletStatusShouldRender: boolean;
  walletTotalBalance: number;
  walletIsLoading: boolean;
}

export function PaymentMethodStoreCreditRows({
  colors,
  onSavingsToggle,
  onWalletToggle,
  savingsAccessibilityLabel,
  savingsCoversFully,
  savingsGoalDisplayName,
  savingsIsActive,
  savingsPortion,
  savingsResidualToGateway,
  savingsShouldRender,
  savingsTotalBalance,
  walletEffectiveTotal,
  walletCoversFully,
  walletInfoShouldRender,
  walletIsActive,
  walletIsLoading,
  walletIsStoreCredit = false,
  walletPortion,
  walletResidualToCard,
  walletShouldRender,
  walletStatusShouldRender,
  walletTotalBalance,
}: PaymentMethodStoreCreditRowsProps) {
  const walletCopy = getWalletCreditCopy(walletIsStoreCredit);
  const walletAccessibilityLabel = walletCopy.accessibilityLabel({
    balance: walletTotalBalance,
    coversFully: walletCoversFully,
    portion: walletPortion,
    total: walletEffectiveTotal,
  });
  return (
    <>
      {savingsShouldRender ? (
        <Pressable
          onPress={onSavingsToggle}
          style={[
            styles.creditRow,
            {
              backgroundColor: savingsIsActive
                ? BRAND.primaryAlpha06
                : colors.card,
              borderColor: savingsIsActive ? BRAND.primary : colors.border,
            },
          ]}
          accessibilityRole={savingsCoversFully ? 'radio' : 'checkbox'}
          accessibilityState={{ checked: savingsIsActive }}
          accessibilityLabel={savingsAccessibilityLabel}
        >
          <View
            style={[
              styles.creditIcon,
              { backgroundColor: `${colors.textSecondary}10` },
            ]}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={18}
              color={savingsIsActive ? colors.text : colors.textSecondary}
            />
          </View>

          <View style={styles.creditInfo}>
            <Text style={[styles.creditLabel, { color: colors.text }]}>
              {savingsCoversFully
                ? 'Pay with device savings'
                : 'Use device savings'}
            </Text>
            <Text style={[styles.creditDesc, { color: colors.textSecondary }]}>
              {savingsCoversFully
                ? `${formatPrice(savingsTotalBalance)} saved · covers full order`
                : `${formatPrice(savingsPortion)} from ${savingsGoalDisplayName} · ${formatPrice(savingsResidualToGateway)} remaining`}
            </Text>
          </View>

          <View
            style={[
              styles.creditIndicator,
              {
                // Always red so the unused credit calls attention.
                borderColor: BRAND.primary,
                backgroundColor: savingsIsActive
                  ? BRAND.primary
                  : 'transparent',
                borderRadius: savingsCoversFully ? 10 : 4,
              },
            ]}
          >
            {savingsIsActive ? (
              <Ionicons name="checkmark" size={12} color="#FFFFFF" />
            ) : null}
          </View>
        </Pressable>
      ) : null}

      {walletStatusShouldRender ? (
        <WalletStatusRow colors={colors} isLoading={walletIsLoading} />
      ) : null}

      {walletInfoShouldRender ? (
        <View
          style={[
            styles.creditRow,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          accessibilityRole="text"
          accessibilityLabel={`${walletCopy.autoApplyLabel}. ${formatPrice(walletPortion)} available now`}
        >
          <View
            style={[
              styles.creditIcon,
              { backgroundColor: `${colors.textSecondary}10` },
            ]}
          >
            <Ionicons
              name="wallet-outline"
              size={18}
              color={colors.textSecondary}
            />
          </View>

          <View style={styles.creditInfo}>
            <Text style={[styles.creditLabel, { color: colors.text }]}>
              {walletCopy.autoApplyLabel}
            </Text>
            <Text style={[styles.creditDesc, { color: colors.textSecondary }]}>
              {`${formatPrice(walletPortion)} available now · transfer shortfall only`}
            </Text>
          </View>
        </View>
      ) : null}

      {walletShouldRender ? (
        <Pressable
          onPress={onWalletToggle}
          style={[
            styles.creditRow,
            {
              backgroundColor: walletIsActive
                ? BRAND.primaryAlpha06
                : colors.card,
              borderColor: walletIsActive ? BRAND.primary : colors.border,
            },
          ]}
          accessibilityRole={walletCoversFully ? 'radio' : 'checkbox'}
          accessibilityState={{ checked: walletIsActive }}
          accessibilityLabel={walletAccessibilityLabel}
        >
          <View
            style={[
              styles.creditIcon,
              { backgroundColor: `${colors.textSecondary}10` },
            ]}
          >
            <Ionicons
              name="wallet-outline"
              size={18}
              color={walletIsActive ? colors.text : colors.textSecondary}
            />
          </View>

          <View style={styles.creditInfo}>
            <Text style={[styles.creditLabel, { color: colors.text }]}>
              {walletCoversFully
                ? walletCopy.coversFullyLabel
                : walletCopy.partialLabel}
            </Text>
            <Text style={[styles.creditDesc, { color: colors.textSecondary }]}>
              {walletCoversFully
                ? `${formatPrice(walletTotalBalance)} available · covers full order`
                : `${formatPrice(walletPortion)} from ${walletCopy.sourceName} · ${formatPrice(walletResidualToCard)} from card`}
            </Text>
          </View>

          <View
            style={[
              styles.creditIndicator,
              {
                // Always red so the unused credit calls attention.
                borderColor: BRAND.primary,
                backgroundColor: walletIsActive ? BRAND.primary : 'transparent',
                borderRadius: walletCoversFully ? 10 : 4,
              },
            ]}
          >
            {walletIsActive ? (
              <Ionicons name="checkmark" size={12} color="#FFFFFF" />
            ) : null}
          </View>
        </Pressable>
      ) : null}
    </>
  );
}
