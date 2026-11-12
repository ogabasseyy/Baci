import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import {
  isHostedStagingTestPaymentsEnabled,
  isHostedStagingWalletTopUpBlocked,
} from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { getDefaultContributionAmount } from './get-default-contribution-amount';
import { getQuickAmountOptions } from './get-quick-amount-options';
import { SavingsQuickAmounts } from './SavingsQuickAmounts';
import { SavingsSheetTextInput } from './SavingsSheetTextInput';
import { useWalletPrimaryReady } from './WalletPrimaryContext';
import { WalletSavingsContributionButton } from './WalletSavingsContributionButton';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';

type WalletSavingsContributionFlowProps = {
  addAmount: string;
  colors: (typeof Colors)['light'];
  isAdding: boolean;
  isFundPending: boolean;
  onAddAmountChange: (value: string) => void;
  onAddSavings: () => void;
  onFundWallet: () => void;
  remainingAmount: number;
  walletBalance: number;
};

export function WalletSavingsContributionFlow({
  addAmount,
  colors,
  isAdding,
  isFundPending,
  onAddAmountChange,
  onAddSavings,
  onFundWallet,
  remainingAmount,
  walletBalance,
}: WalletSavingsContributionFlowProps) {
  const primaryReady = useWalletPrimaryReady();
  const [isFundFocused, setIsFundFocused] = useState(false);
  const [hasSeededAmount, setHasSeededAmount] = useState(false);
  const defaultAmount = getDefaultContributionAmount({
    available: walletBalance,
    remaining: remainingAmount,
  });
  // Start from a sensible amount (never more than the wallet holds or the
  // goal still needs). Only an empty field is filled, and only once, so
  // nothing the customer typed or a returning top-up amount is overwritten.
  useEffect(() => {
    if (hasSeededAmount) return;
    if (addAmount.trim().length > 0) {
      setHasSeededAmount(true);
    } else if (defaultAmount > 0) {
      setHasSeededAmount(true);
      onAddAmountChange(String(defaultAmount));
    }
  }, [addAmount, defaultAmount, hasSeededAmount, onAddAmountChange]);
  const amount = Number(addAmount);
  const quickAmounts = getQuickAmountOptions({
    available: walletBalance,
    remaining: remainingAmount,
  });
  const hasAmount = addAmount.trim().length > 0;
  const invalidAmount =
    hasAmount &&
    (!Number.isSafeInteger(amount) || amount <= 0 || amount > remainingAmount);
  const validAmount = hasAmount && !invalidAmount;
  const needsFunding =
    walletBalance <= 0 || (validAmount && amount > walletBalance);
  const isBusy = isAdding || isFundPending;
  // PiggyVest main wallet: money arrives by bank transfer into the wallet,
  // never through a card payment, so the staging card-top-up switches
  // do not apply.
  const usesPlanFunding = !primaryReady && isHostedStagingTestPaymentsEnabled();
  const topUpBlocked =
    !primaryReady && !usesPlanFunding && isHostedStagingWalletTopUpBlocked();
  const guidance = invalidAmount
    ? amount > remainingAmount
      ? `This plan only needs ${formatNgnCurrency(remainingAmount)} more. Enter a smaller amount.`
      : 'Enter an amount greater than zero.'
    : needsFunding
      ? primaryReady
        ? 'Add money to your wallet to save this amount.'
        : usesPlanFunding
          ? 'Add money to your wallet to save this amount. This is a staging preview, so do not send real money.'
          : topUpBlocked
            ? 'Wallet top-ups are disabled in this hosted staging preview. You can add to this plan when the wallet already has funds.'
            : 'Add money to your wallet to save this amount.'
      : validAmount
        ? null
        : 'Enter an amount to move from your wallet into this plan.';

  return (
    <View style={styles.addSection}>
      {/* The amount is the hero: big and centred, with what the wallet holds. */}
      <View style={styles.amountHero}>
        <View style={styles.amountHeroRow}>
          <Text style={[styles.amountPrefix, { color: colors.text }]}>₦</Text>
          <SavingsSheetTextInput
            accessibilityLabel="Savings top-up amount"
            value={addAmount
              .replace(/\D/g, '')
              .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            editable={!isBusy}
            onChangeText={(text) => {
              setHasSeededAmount(true);
              onAddAmountChange(text.replace(/\D/g, ''));
            }}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.placeholder}
            style={[styles.amountInputField, { color: colors.text }]}
          />
        </View>
        <Text style={[styles.walletHint, { color: colors.textSecondary }]}>
          {`${formatNgnCurrency(walletBalance)} available in wallet`}
        </Text>
      </View>
      <SavingsQuickAmounts
        colors={colors}
        disabled={isBusy}
        onSelect={(value) => {
          setHasSeededAmount(true);
          onAddAmountChange(String(value));
        }}
        options={quickAmounts}
        selectedAmount={amount}
      />
      {guidance ? (
        <Text
          accessibilityRole="text"
          style={[
            styles.contributionGuidance,
            { color: invalidAmount ? colors.error : colors.textSecondary },
          ]}
        >
          {guidance}
        </Text>
      ) : null}
      {!invalidAmount ? (
        needsFunding ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              topUpBlocked
                ? 'Wallet funding unavailable'
                : primaryReady
                  ? 'Add money to wallet'
                  : usesPlanFunding
                    ? 'Add money for savings'
                    : 'Continue to payment'
            }
            accessibilityState={{
              disabled: !validAmount || isBusy || topUpBlocked,
              busy: isFundPending,
            }}
            disabled={!validAmount || isBusy || topUpBlocked}
            onFocus={() => setIsFundFocused(true)}
            onBlur={() => setIsFundFocused(false)}
            onPress={onFundWallet}
            style={[
              styles.primaryButton,
              {
                backgroundColor: topUpBlocked ? colors.muted : colors.primary,
              },
              isFundFocused && {
                borderColor: colors.primaryForeground,
                borderWidth: 2,
              },
              (!validAmount || isBusy || topUpBlocked) && styles.disabledButton,
            ]}
          >
            <Text
              style={[
                styles.primaryButtonText,
                {
                  color: topUpBlocked
                    ? colors.textSecondary
                    : colors.primaryForeground,
                },
              ]}
            >
              {topUpBlocked
                ? 'Wallet funding unavailable'
                : primaryReady
                  ? 'Add money'
                  : isFundPending
                    ? usesPlanFunding
                      ? 'Opening wallet funding...'
                      : 'Opening payment...'
                    : usesPlanFunding
                      ? 'Add money'
                      : 'Continue to payment'}
            </Text>
          </Pressable>
        ) : (
          <WalletSavingsContributionButton
            amount={validAmount ? amount : undefined}
            colors={colors}
            disabled={!validAmount}
            isAdding={isAdding}
            onPress={onAddSavings}
          />
        )
      ) : null}
    </View>
  );
}
