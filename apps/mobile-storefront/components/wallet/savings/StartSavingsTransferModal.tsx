import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { BRAND, palette } from '@/constants/Colors';
import { setClipboardString } from '@/lib/clipboard';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { SavingsPlanFundingAccount } from '@/schemas/customer-savings';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';
import { SummaryRow } from './start-savings-modal-parts';

type TransferModalProps = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

function handleSavingsActionError(
  error: unknown,
  title: string,
  message: string
) {
  console.error(title, error);
  showAppAlert({ title, message, variant: 'error' });
}

// Hoisted: try/finally in a component body blocks React Compiler.
async function runCopyFundingAccount(
  copyFundingAccount: () => Promise<void>,
  setIsCopying: (isCopying: boolean) => void
) {
  setIsCopying(true);
  try {
    await copyFundingAccount();
  } catch (error) {
    handleSavingsActionError(
      error,
      'Unable to copy account',
      'Failed to copy funding account. Please try again.'
    );
  } finally {
    setIsCopying(false);
  }
}

export function StartSavingsTransferModal({
  colors,
  controller,
}: TransferModalProps) {
  if (controller.createdGoalId) {
    return <PlanTransferMode colors={colors} controller={controller} />;
  }
  return <WalletTransferMode colors={colors} controller={controller} />;
}

function WalletTransferMode({ colors, controller }: TransferModalProps) {
  const transferAmount = Math.max(
    controller.requiredTopUpAmount,
    controller.contributionValue
  );

  return (
    <ModalSheet
      visible={controller.showTransferModal}
      animationType="slide"
      backdropStyle={styles.modalBackdrop}
      cardStyle={[styles.modalCard, { backgroundColor: colors.background }]}
    >
      <Text style={[styles.modalTitle, { color: colors.text }]}>
        Fund wallet to continue
      </Text>
      <View
        style={[
          styles.transferCard,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <SummaryRow
          label="Transfer amount"
          value={formatNgnCurrency(transferAmount)}
          colors={colors}
        />
        {controller.fundingAccount ? (
          <FundingAccountDetails colors={colors} controller={controller} />
        ) : (
          <Text
            style={[
              styles.emptyFundingAccountText,
              { color: colors.textSecondary },
            ]}
          >
            Create your account number from the wallet funding screen before
            continuing.
          </Text>
        )}
      </View>
      <TransferActions colors={colors} controller={controller} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open wallet funding screen"
        style={styles.modalCloseButton}
        onPress={controller.openWalletFundingScreen}
      >
        <Text style={[styles.modalCloseText, { color: colors.textSecondary }]}>
          Open wallet funding screen
        </Text>
      </Pressable>
    </ModalSheet>
  );
}

function TransferActions({ colors, controller }: TransferModalProps) {
  const [isCopying, setIsCopying] = useState(false);

  const handleCopyFundingAccount = () =>
    runCopyFundingAccount(
      () => controller.handleCopyFundingAccount(),
      setIsCopying
    );

  const handleRetrySavingsCreation = async () => {
    try {
      await controller.submitSavingsGoal();
    } catch (error) {
      handleSavingsActionError(
        error,
        'Unable to retry savings',
        'Failed to retry savings creation. Please try again.'
      );
    }
  };

  return (
    <View style={styles.transferActionRow}>
      {controller.fundingAccount ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy savings funding account number"
          accessibilityState={{ disabled: isCopying }}
          disabled={isCopying}
          style={[
            styles.secondaryButton,
            { borderColor: colors.border },
            isCopying ? styles.buttonDisabled : null,
          ]}
          onPress={handleCopyFundingAccount}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
            {isCopying ? 'Copying...' : 'Copy account'}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry savings creation"
        accessibilityState={{ disabled: controller.isSubmitting }}
        style={[
          styles.secondaryButton,
          { borderColor: BRAND.primary, backgroundColor: BRAND.primary },
          controller.isSubmitting ? styles.buttonDisabled : null,
        ]}
        onPress={handleRetrySavingsCreation}
        disabled={controller.isSubmitting}
      >
        <Text style={[styles.secondaryButtonText, { color: palette.white }]}>
          I&apos;ve funded wallet
        </Text>
      </Pressable>
    </View>
  );
}

function FundingAccountDetails({ colors, controller }: TransferModalProps) {
  if (!controller.fundingAccount) {
    return null;
  }

  return (
    <>
      <View style={styles.transferAccountRow}>
        <Text
          style={[styles.transferMetaLabel, { color: colors.textSecondary }]}
        >
          Account number
        </Text>
        <Text style={[styles.transferMetaValue, { color: colors.text }]}>
          {controller.fundingAccount.account_number}
        </Text>
      </View>
      <View style={styles.transferAccountRow}>
        <Text
          style={[styles.transferMetaLabel, { color: colors.textSecondary }]}
        >
          Bank
        </Text>
        <Text style={[styles.transferMetaValue, { color: colors.text }]}>
          {controller.fundingAccount.bank_name}
        </Text>
      </View>
    </>
  );
}

function PlanTransferMode({ colors, controller }: TransferModalProps) {
  const [bvn, setBvn] = useState('');
  const [earnInterest, setEarnInterest] = useState(false);
  const transferAmount = Math.max(
    controller.requiredTopUpAmount,
    controller.contributionValue
  );
  const phase = controller.planFundingPhase;

  const handleFetchPlanAccount = async () => {
    try {
      await controller.fetchPlanFunding(bvn, {
        enableInterestAccrual: earnInterest,
      });
    } catch (error) {
      handleSavingsActionError(
        error,
        'Unable to load plan account',
        'Failed to load the plan account. Please try again.'
      );
    }
  };

  const handleConfirmTransfer = async () => {
    try {
      await controller.confirmPlanTransfer();
    } catch (error) {
      handleSavingsActionError(
        error,
        'Unable to confirm transfer',
        'Failed to confirm the transfer. Please try again.'
      );
    }
  };

  const handleContributeFromWallet = async () => {
    try {
      await controller.submitBankTransferContribution();
    } catch (error) {
      handleSavingsActionError(
        error,
        'Unable to record contribution',
        'Failed to record the contribution. Please try again.'
      );
    }
  };

  return (
    <ModalSheet
      visible={controller.showTransferModal}
      animationType="slide"
      backdropStyle={styles.modalBackdrop}
      cardStyle={[styles.modalCard, { backgroundColor: colors.background }]}
    >
      <Text style={[styles.modalTitle, { color: colors.text }]}>
        Fund your plan to continue
      </Text>
      <View
        style={[
          styles.transferCard,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <SummaryRow
          label="Transfer amount"
          value={formatNgnCurrency(transferAmount)}
          colors={colors}
        />
        {phase === 'ready' ? (
          <PlanFundingAccountDetails
            account={controller.planFundingAccounts[0]}
            colors={colors}
          />
        ) : (
          <PlanFundingLookup
            colors={colors}
            controller={controller}
            bvn={bvn}
            earnInterest={earnInterest}
            onBvnChange={setBvn}
            onEarnInterestChange={setEarnInterest}
            onFetch={handleFetchPlanAccount}
          />
        )}
        {phase === 'pending' ? (
          <Text
            style={[
              styles.emptyFundingAccountText,
              { color: colors.textSecondary },
            ]}
          >
            Your dedicated account is being prepared. Check again shortly.
          </Text>
        ) : null}
        {phase === 'unavailable' || phase === 'error' ? (
          <PlanFundingFallback colors={colors} controller={controller} />
        ) : null}
      </View>
      <PlanTransferActions
        colors={colors}
        controller={controller}
        onConfirmTransfer={handleConfirmTransfer}
        onContributeFromWallet={handleContributeFromWallet}
      />
    </ModalSheet>
  );
}

function PlanFundingLookup({
  bvn,
  colors,
  controller,
  earnInterest,
  onBvnChange,
  onEarnInterestChange,
  onFetch,
}: TransferModalProps & {
  bvn: string;
  earnInterest: boolean;
  onBvnChange: (value: string) => void;
  onEarnInterestChange: (value: boolean) => void;
  onFetch: () => void;
}) {
  const isLoading = controller.planFundingPhase === 'loading';
  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.transferMetaLabel, { color: colors.textSecondary }]}>
        Enter the 11-digit BVN linked to this plan to reveal its dedicated
        account. It is used once to prepare the transfer and never stored.
      </Text>
      <TextInput
        accessibilityLabel="BVN for plan account"
        keyboardType="number-pad"
        maxLength={11}
        onChangeText={onBvnChange}
        placeholder="11-digit BVN"
        placeholderTextColor={colors.textSecondary}
        secureTextEntry
        style={[
          styles.input,
          { borderColor: colors.border, color: colors.text },
        ]}
        value={bvn}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Earn interest on this plan"
        accessibilityState={{ checked: earnInterest }}
        onPress={() => onEarnInterestChange(!earnInterest)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: earnInterest ? BRAND.primary : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {earnInterest ? (
            <Text style={{ color: palette.white, fontWeight: '700' }}>✓</Text>
          ) : null}
        </View>
        <Text style={[styles.transferMetaLabel, { color: colors.text }]}>
          Earn interest on this plan
        </Text>
      </Pressable>
      {controller.planFundingError ? (
        <Text style={[styles.errorText, { color: colors.error }]}>
          {controller.planFundingError}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show plan account"
        accessibilityState={{ disabled: controller.isSubmitting || isLoading }}
        disabled={controller.isSubmitting || isLoading}
        style={[
          styles.secondaryButton,
          { borderColor: BRAND.primary, backgroundColor: BRAND.primary },
          controller.isSubmitting || isLoading ? styles.buttonDisabled : null,
        ]}
        onPress={onFetch}
      >
        <Text style={[styles.secondaryButtonText, { color: palette.white }]}>
          {isLoading ? 'Loading…' : 'Show plan account'}
        </Text>
      </Pressable>
    </View>
  );
}

function PlanFundingAccountDetails({
  account,
  colors,
}: {
  account: SavingsPlanFundingAccount | undefined;
  colors: StartSavingsColors;
}) {
  const [isCopying, setIsCopying] = useState(false);
  if (!account) {
    return null;
  }
  const handleCopyPlanAccount = () =>
    runCopyFundingAccount(async () => {
      const copied = await setClipboardString(account.accountNumber);
      showAppAlert({
        title: copied ? 'Copied' : 'Unable to copy',
        message: copied
          ? 'Account number copied to clipboard.'
          : 'Unable to copy account number.',
        variant: copied ? 'success' : 'error',
      });
    }, setIsCopying);

  return (
    <>
      <View style={styles.transferAccountRow}>
        <Text
          style={[styles.transferMetaLabel, { color: colors.textSecondary }]}
        >
          Account number
        </Text>
        <Text style={[styles.transferMetaValue, { color: colors.text }]}>
          {account.accountNumber}
        </Text>
      </View>
      <View style={styles.transferAccountRow}>
        <Text
          style={[styles.transferMetaLabel, { color: colors.textSecondary }]}
        >
          Account name
        </Text>
        <Text style={[styles.transferMetaValue, { color: colors.text }]}>
          {account.accountName}
        </Text>
      </View>
      <View style={styles.transferAccountRow}>
        <Text
          style={[styles.transferMetaLabel, { color: colors.textSecondary }]}
        >
          Bank
        </Text>
        <Text style={[styles.transferMetaValue, { color: colors.text }]}>
          {account.bankName}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy plan account number"
        accessibilityState={{ disabled: isCopying }}
        disabled={isCopying}
        style={[
          styles.secondaryButton,
          { borderColor: colors.border },
          isCopying ? styles.buttonDisabled : null,
        ]}
        onPress={handleCopyPlanAccount}
      >
        <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
          {isCopying ? 'Copying...' : 'Copy account'}
        </Text>
      </Pressable>
      <Text
        style={[
          styles.emptyFundingAccountText,
          { color: colors.textSecondary },
        ]}
      >
        Transfer to this account from your bank app, then confirm below.
      </Text>
    </>
  );
}

function PlanFundingFallback({ colors, controller }: TransferModalProps) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={[
          styles.emptyFundingAccountText,
          { color: colors.textSecondary },
        ]}
      >
        {controller.planFundingPhase === 'error'
          ? (controller.planFundingError ??
            'The plan account is unavailable right now.')
          : 'The plan account is not ready yet.'}{' '}
        Fund your wallet instead and record the contribution below.
      </Text>
      {controller.fundingAccount ? (
        <FundingAccountDetails colors={colors} controller={controller} />
      ) : null}
    </View>
  );
}

function PlanTransferActions({
  colors,
  controller,
  onConfirmTransfer,
  onContributeFromWallet,
}: TransferModalProps & {
  onConfirmTransfer: () => void;
  onContributeFromWallet: () => void;
}) {
  const usePlanAccount =
    controller.planFundingPhase === 'ready' &&
    controller.planFundingAccounts.length > 0;
  return (
    <View style={styles.transferActionRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open wallet funding screen"
        style={styles.modalCloseButton}
        onPress={controller.openWalletFundingScreen}
      >
        <Text style={[styles.modalCloseText, { color: colors.textSecondary }]}>
          Open wallet funding screen
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          usePlanAccount
            ? 'Confirm plan transfer'
            : 'Record wallet contribution'
        }
        accessibilityState={{ disabled: controller.isSubmitting }}
        style={[
          styles.secondaryButton,
          { borderColor: BRAND.primary, backgroundColor: BRAND.primary },
          controller.isSubmitting ? styles.buttonDisabled : null,
        ]}
        onPress={usePlanAccount ? onConfirmTransfer : onContributeFromWallet}
        disabled={controller.isSubmitting}
      >
        <Text style={[styles.secondaryButtonText, { color: palette.white }]}>
          {usePlanAccount ? "I've made the transfer" : "I've funded wallet"}
        </Text>
      </Pressable>
    </View>
  );
}
