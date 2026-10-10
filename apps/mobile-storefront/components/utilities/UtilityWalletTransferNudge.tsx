import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, SPACING } from '@/constants/Colors';
import { navigateToWalletFunding } from '@/lib/navigate-to-wallet-funding';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';

type WalletColors = (typeof Colors)['light'];

const WALLET_FUNDING_NUDGE =
  'Pay from your wallet to skip card fees — transfers to your wallet account number cost 1%, capped at ₦300.';
const WALLET_FUNDING_CTA = 'Pay with Bank Transfer';

interface UtilityWalletTransferNudgeProps {
  amount: number;
  /**
   * True only when the customer is signed in AND the merchant has wallet
   * DVAs enabled. Gates the nudge so we never advertise a bank-transfer
   * funding path that routes to a DVA_DISABLED / login dead end.
   */
  canFundByBankTransfer: boolean;
  colors: WalletColors;
  /**
   * Prefilled `/utilities/<type>?repeat…` deep-link the wallet returns the
   * customer to after topping up. When present (and the dark-launch flag is
   * on) it is threaded through as `returnTo`; otherwise the nudge behaves
   * exactly as before and opens the wallet with no return route.
   */
  returnToHref?: WalletReturnHref;
  walletBalance?: number;
  walletError?: Error | null;
  walletIsLoading?: boolean;
}

export function UtilityWalletTransferNudge({
  amount,
  canFundByBankTransfer,
  colors,
  returnToHref,
  walletBalance,
  walletError,
  walletIsLoading,
}: UtilityWalletTransferNudgeProps) {
  const handlePress = () => {
    navigateToWalletFunding(returnToHref);
  };

  const visible =
    canFundByBankTransfer &&
    walletIsLoading !== true &&
    !walletError &&
    amount > 0 &&
    (walletBalance ?? 0) < amount;

  if (!visible) {
    return null;
  }

  return (
    <View
      style={[
        styles.walletNudge,
        {
          backgroundColor: `${BRAND.primary}10`,
          borderColor: `${BRAND.primary}30`,
        },
      ]}
    >
      <Text style={[styles.walletNudgeText, { color: colors.text }]}>
        {WALLET_FUNDING_NUDGE}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={WALLET_FUNDING_CTA}
        onPress={handlePress}
      >
        <Text style={styles.walletNudgeCta}>{WALLET_FUNDING_CTA}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  walletNudge: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    marginBottom: SPACING.md,
    padding: SPACING.md,
  },
  walletNudgeCta: {
    color: BRAND.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  walletNudgeText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
