import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { BRAND, type default as Colors, palette } from '@/constants/Colors';
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
  usesWalletBankTransfer?: boolean;
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
  usesWalletBankTransfer = false,
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
  const topUpBlocked =
    !usesWalletBankTransfer &&
    !usesPlanFunding &&
    isHostedStagingWalletTopUpBlocked();
  const guidance = invalidAmount
    ? amount > remainingAmount
      ? `This plan only needs ${formatNgnCurrency(remainingAmount)} more. Enter a smaller amount.`
      : 'Enter an amount greater than zero.'
    : needsFunding
      ? usesWalletBankTransfer
        ? 'Add money to your wallet, then move it into this savings plan.'
        : usesPlanFunding
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
            borderColor: BRAND.primary,
            borderWidth: 2,
          },
        ]}
      >
        <Text style={[styles.amountPrefix, { color: colors.text }]}>₦</Text>
        <BottomSheetTextInput
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
              usesWalletBankTransfer
                ? 'Open wallet bank transfer details'
                : usesPlanFunding
                  ? 'Open savings bank transfer details'
                  : 'Continue to payment'
            }
            accessibilityState={{
              disabled:
                (!usesWalletBankTransfer && !validAmount) ||
                isBusy ||
                topUpBlocked,
              busy: isFundPending,
            }}
            disabled={
              (!usesWalletBankTransfer && !validAmount) ||
              isBusy ||
              topUpBlocked
            }
            onFocus={() => setIsFundFocused(true)}
            onBlur={() => setIsFundFocused(false)}
            onPress={() => {
              Keyboard.dismiss();
              onFundWallet();
            }}
            style={[
              styles.primaryButton,
              {
                backgroundColor: BRAND.primary,
              },
              isFundFocused && {
                borderColor: colors.primaryForeground,
                borderWidth: 2,
              },
              ((!usesWalletBankTransfer && !validAmount) ||
                isBusy ||
                topUpBlocked) &&
                styles.disabledButton,
            ]}
          >
            <Text
              style={[
                styles.primaryButtonText,
                {
                  color: palette.white,
                },
              ]}
            >
              {isFundPending
                ? usesPlanFunding
                  ? 'Opening transfer details...'
                  : 'Opening payment...'
                : usesWalletBankTransfer
                  ? 'Add money to wallet'
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
