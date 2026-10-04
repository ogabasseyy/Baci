import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import {
  isHostedStagingTestPaymentsEnabled,
  isHostedStagingWalletTopUpBlocked,
} from '@/lib/is-hosted-staging-wallet-top-up-blocked';
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
  const [isFundFocused, setIsFundFocused] = useState(false);
  const amount = Number(addAmount);
  const hasAmount = addAmount.trim().length > 0;
  const invalidAmount =
    hasAmount &&
    (!Number.isSafeInteger(amount) || amount <= 0 || amount > remainingAmount);
  const validAmount = hasAmount && !invalidAmount;
  const needsFunding =
    walletBalance <= 0 || (validAmount && amount > walletBalance);
  const isBusy = isAdding || isFundPending;
  const usesPlanFunding = isHostedStagingTestPaymentsEnabled();
  const topUpBlocked = !usesPlanFunding && isHostedStagingWalletTopUpBlocked();
  const guidance = invalidAmount
    ? amount > remainingAmount
      ? `This plan only needs ${formatNgnCurrency(remainingAmount)} more. Enter a smaller amount.`
      : 'Enter an amount greater than zero.'
    : needsFunding
      ? usesPlanFunding
        ? 'Use the plan transfer details for this staging goal. Do not send a real bank transfer; approved operators run test funding.'
        : topUpBlocked
          ? 'Wallet top-ups are disabled in this hosted staging preview. You can add to this plan when the wallet already has funds.'
          : 'Fund your wallet to add this amount to savings.'
      : validAmount
        ? `Move ${formatNgnCurrency(amount)} from your wallet into this plan.`
        : 'Enter an amount to move from your wallet into this plan.';

  return (
    <View style={styles.addSection}>
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        Amount to add from wallet
      </Text>
      <View
        style={[
          styles.amountInput,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.amountPrefix, { color: colors.text }]}>₦</Text>
        <TextInput
          accessibilityLabel="Savings top-up amount"
          value={addAmount
            .replace(/\D/g, '')
            .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
          editable={!isBusy}
          onChangeText={(text) => onAddAmountChange(text.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={colors.placeholder}
          style={[styles.amountInputField, { color: colors.text }]}
        />
      </View>
      <Text style={[styles.walletHint, { color: colors.textSecondary }]}>
        Available in wallet: {formatNgnCurrency(walletBalance)}
      </Text>
      <Text
        accessibilityRole="text"
        style={[
          styles.contributionGuidance,
          { color: invalidAmount ? colors.error : colors.textSecondary },
        ]}
      >
        {guidance}
      </Text>
      {!invalidAmount ? (
        needsFunding ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              usesPlanFunding
                ? 'Open savings bank transfer details'
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
                backgroundColor: colors.primary,
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
                  color: colors.primaryForeground,
                },
              ]}
            >
              {isFundPending
                ? usesPlanFunding
                  ? 'Opening transfer details...'
                  : 'Opening payment...'
                : usesPlanFunding
                  ? 'View bank transfer details'
                  : 'Continue to payment'}
            </Text>
          </Pressable>
        ) : (
          <WalletSavingsContributionButton
            disabled={!validAmount}
            isAdding={isAdding}
            onPress={onAddSavings}
          />
        )
      ) : null}
    </View>
  );
}
