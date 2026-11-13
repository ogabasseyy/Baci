import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { PiggyvestSlowdownNotice } from './PiggyvestSlowdownNotice';
import { SavingsBottomSheet } from './SavingsBottomSheet';
import { SavingsGoalSummary } from './SavingsGoalSummary';
import { GoalLifecycleEntry } from './savings/GoalLifecycleEntry';
import { usePlanStillSettingUp } from './savings/use-plan-still-setting-up';
import { WalletPendingSavingsContribution } from './WalletPendingSavingsContribution';
import { WalletSavingsFundingSection } from './WalletSavingsFundingSection';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';

const COMPACT_SNAP_POINTS = ['64%', '92%'];

type WalletColors = (typeof Colors)['light'];

type WalletSavingsProgressModalProps = {
  addAmount: string;
  colors: WalletColors;
  goal: WalletActiveSavingsGoal | null;
  isAdding: boolean;
  hasPendingContribution?: boolean;
  isFundPending?: boolean;
  onAddAmountChange: (value: string) => void;
  onAddSavings: () => void;
  onChangeDevice: () => void;
  onClose: () => void;
  onFundWallet: () => void;
  onRefreshWallet?: () => Promise<unknown>;
  onResolveVariant?: () => void;
  /** Rendered inside the sheet's modal so it can appear above it on iOS. */
  overlay?: ReactNode;
  visible: boolean;
  walletBalance: number;
  walletUpdatedAt?: number;
};

export function WalletSavingsProgressModal({
  addAmount,
  colors: themeColors,
  goal,
  isAdding,
  hasPendingContribution = false,
  isFundPending = false,
  onAddAmountChange,
  onAddSavings,
  onChangeDevice,
  onClose,
  onFundWallet,
  onRefreshWallet,
  onResolveVariant,
  overlay,
  visible,
  walletBalance,
  walletUpdatedAt,
}: WalletSavingsProgressModalProps) {
  const colors = {
    ...themeColors,
    primary: BRAND.primary,
    primaryForeground: BRAND.onPrimary,
    primaryLowOpacity: BRAND.primaryAlpha12,
  };
  // Matches the wallet card: "View plan" there means not "Add to savings" here.
  const settingUp = usePlanStillSettingUp(goal);
  if (!goal) {
    return null;
  }

  const amountLeft = Math.max(0, goal.target_amount - goal.current_amount);
  const usesPlanFunding = isHostedStagingTestPaymentsEnabled();
  const canAddToSavings =
    (goal.source_mode === 'manual' || usesPlanFunding) &&
    goal.status !== 'completed';
  const addTitle = canAddToSavings && !settingUp;
  const canChangeDevice =
    canAddToSavings ||
    (goal.selection_unresolved &&
      (goal.status !== 'completed' ||
        !goal.variant_resolution_options?.length));
  const unavailableContributionMessage =
    goal.status === 'completed'
      ? 'This savings goal is complete.'
      : 'This goal is funded by scheduled auto-debit.';

  return (
    <SavingsBottomSheet
      visible={visible}
      colors={colors}
      // Nothing saved yet means no progress card: open shorter so the sheet
      // does not end in empty space. It still expands on drag.
      snapPoints={goal.current_amount > 0 ? undefined : COMPACT_SNAP_POINTS}
      onClose={onClose}
      overlay={overlay}
    >
      {(dismiss) => (
        <>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View
                style={[
                  styles.titleIcon,
                  { backgroundColor: colors.primaryLowOpacity },
                ]}
              >
                <Ionicons
                  name={addTitle ? 'wallet-outline' : 'flag-outline'}
                  size={16}
                  color={colors.primary}
                />
              </View>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: colors.primary }]}
              >
                {addTitle ? 'Add to savings' : 'Your savings plan'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close savings progress"
              onPress={dismiss}
              style={styles.iconButton}
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>

          <BottomSheetScrollView
            style={styles.scrollView}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <PiggyvestSlowdownNotice />
            <SavingsGoalSummary
              colors={colors}
              goal={goal}
              onChangeDevice={canChangeDevice ? onChangeDevice : undefined}
              onResolveVariant={onResolveVariant}
            />
            {hasPendingContribution ? (
              <WalletPendingSavingsContribution
                colors={colors}
                isChecking={isAdding}
                onCheck={onAddSavings}
              />
            ) : canAddToSavings ? (
              <WalletSavingsFundingSection
                addAmount={addAmount}
                colors={colors}
                goal={goal}
                isAdding={isAdding}
                isFundPending={isFundPending}
                onAddAmountChange={onAddAmountChange}
                onAddSavings={onAddSavings}
                onFundWallet={onFundWallet}
                onRefreshWallet={onRefreshWallet}
                remainingAmount={amountLeft}
                usesPlanFunding={usesPlanFunding}
                visible={visible}
                walletBalance={walletBalance}
                walletUpdatedAt={walletUpdatedAt}
              />
            ) : (
              <Text
                style={[styles.autoDebitHint, { color: colors.textSecondary }]}
              >
                {unavailableContributionMessage}
              </Text>
            )}
            {/* Cancelling stays available but quiet, under the main button. */}
            <View style={styles.footerLinks}>
              <GoalLifecycleEntry
                colors={colors}
                goal={goal}
                hasPendingContribution={hasPendingContribution}
                onBeforeNavigate={onClose}
                walletUpdatedAt={walletUpdatedAt}
              />
            </View>
          </BottomSheetScrollView>
        </>
      )}
    </SavingsBottomSheet>
  );
}
