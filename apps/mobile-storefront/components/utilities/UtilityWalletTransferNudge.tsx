import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, SPACING } from '@/constants/Colors';
import { navigateToStoreCreditTopUp } from '@/lib/navigate-to-store-credit-top-up';
import { navigateToWalletFunding } from '@/lib/navigate-to-wallet-funding';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';

type WalletColors = (typeof Colors)['light'];

const WALLET_FUNDING_NUDGE =
  'Pay from your wallet to skip card fees — transfers to your wallet account number cost 1%, capped at ₦300.';
const WALLET_FUNDING_CTA = 'Pay with Bank Transfer';
const STORE_CREDIT_NUDGE =
  'Not enough store credit. Your savings wallet can’t pay for this yet, so add store credit by card.';
const STORE_CREDIT_CTA = 'Add store credit';

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
  /** PiggyVest customer: utilities spend store credit, added by card. */
  walletIsStoreCredit?: boolean;
  /**
   * False while the wallet query is disabled with no data: the
   * funding nudge must stay hidden (a missing balance is not a zero
   * balance — Codex R130 P2).
   */
  walletIsSettled?: boolean;
}

export function UtilityWalletTransferNudge({
  amount,
  canFundByBankTransfer,
  colors,
  returnToHref,
  walletBalance,
  walletError,
  walletIsLoading,
  walletIsSettled,
  walletIsStoreCredit = false,
}: UtilityWalletTransferNudgeProps) {
  const storeCredit = walletIsStoreCredit && Boolean(returnToHref);
  const handlePress = () => {
    if (storeCredit && returnToHref) {
      navigateToStoreCreditTopUp(amount - (walletBalance ?? 0), returnToHref);
      return;
    }
    navigateToWalletFunding(returnToHref);
  };

  // A PiggyVest customer is never sent to bank transfer (it would fund the
  // savings wallet); without a return link there is no store credit path.
  const visible =
    (storeCredit || (canFundByBankTransfer && !walletIsStoreCredit)) &&
    walletIsLoading !== true &&
    walletIsSettled !== false &&
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
        {storeCredit ? STORE_CREDIT_NUDGE : WALLET_FUNDING_NUDGE}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={storeCredit ? STORE_CREDIT_CTA : WALLET_FUNDING_CTA}
        onPress={handlePress}
      >
        <Text style={styles.walletNudgeCta}>
          {storeCredit ? STORE_CREDIT_CTA : WALLET_FUNDING_CTA}
        </Text>
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
