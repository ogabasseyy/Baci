import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { answerWalletFundPrompt } from './fund/answer-wallet-fund-prompt';
import { WalletFundPromptCard } from './fund/WalletFundPromptCard';
import { PiggyvestSlowdownNotice } from './PiggyvestSlowdownNotice';
import { SavingsBottomSheet } from './SavingsBottomSheet';
import { SavingsGoalSummary } from './SavingsGoalSummary';
import { clearSavingsNotice } from './savings/clear-savings-notice';
import { GoalCancelStep } from './savings/GoalCancelStep';
import { GoalCompleteStep } from './savings/GoalCompleteStep';
import { GoalLifecycleEntry } from './savings/GoalLifecycleEntry';
import { isFundedUnsettledGoal } from './savings/goal-settlement';
import { SavingsNoticeCard } from './savings/SavingsNoticeCard';
import {
  useGoalCancelSheetHeight,
  useStepSheetHeight,
} from './savings/use-goal-cancel-sheet-height';
import { useInSheetGoalCancel } from './savings/use-in-sheet-goal-cancel';
import { usePlanStillSettingUp } from './savings/use-plan-still-setting-up';
import { WalletPinSheet } from './savings/WalletPinSheet';
import { withSavingsBrand } from './savings-sheet-colors';
import { useHeldWhileAdding } from './use-held-while-adding';
import { WalletPendingSavingsContribution } from './WalletPendingSavingsContribution';
import { WalletSavingsFundingSection } from './WalletSavingsFundingSection';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';
import type { WalletSavingsProgressModalProps } from './wallet-savings-progress-modal.types';

const COMPACT_SNAP_POINTS = ['64%', '92%'];
/** The header's bottom margin (SPACING.md), outside its measured height. */
const HEADER_GAP = 16;

export function WalletSavingsProgressModal({
  addAmount,
  colors: themeColors,
  goal,
  isAdding,
  hasPendingContribution = false,
  isCheckingContribution = false,
  isContributionRetry,
  isFundPending = false,
  onAddAmountChange,
  onAddSavings,
  onChangeDevice,
  onCheckContribution,
  onClose,
  onFundWallet,
  onRefreshWallet,
  onResolveVariant,
  overlay,
  phoneSwapStep,
  visible,
  walletBalance,
  walletUpdatedAt,
}: WalletSavingsProgressModalProps) {
  const colors = withSavingsBrand(themeColors);
  // Matches the wallet card: "View plan" there means not "Add to savings" here.
  const settingUp = usePlanStillSettingUp(goal);
  const cancel = useInSheetGoalCancel(goal, onRefreshWallet, visible);
  // Every close drops an unsent cancel/complete review, declines a waiting
  // funding question (else its funding never settles) and resets the parent.
  const closeSheet = () => {
    cancel.closed();
    answerWalletFundPrompt(false);
    onClose();
  };
  // The sheet is sized to what it shows, so it never ends in empty space.
  const cancelSheet = useGoalCancelSheetHeight(cancel);
  const swapSheet = useStepSheetHeight(phoneSwapStep ? 'swap' : null, false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [bodyHeight, setBodyHeight] = useState(0);
  // An add in flight hides a few links: keep the height under the PIN step.
  const mainHeight = useHeldWhileAdding(
    isAdding,
    headerHeight > 0 && bodyHeight > 0
      ? headerHeight + HEADER_GAP + bodyHeight
      : undefined
  );
  if (!goal && !cancel.goal) {
    return null;
  }
  if (cancel.goal) {
    const cancelGoal = cancel.goal;
    // Sign in, then come back to this goal's savings sheet.
    const signIn = (dismiss: () => void) => {
      dismiss();
      // Back via the goal link route, which re-checks the goal's account.
      const back = `/wallet/savings/goal-actions?goalId=${encodeURIComponent(cancelGoal.id)}`;
      router.push(`/auth/login?returnTo=${encodeURIComponent(back)}`);
    };
    return (
      <SavingsBottomSheet
        visible={visible}
        colors={colors}
        snapPoints={COMPACT_SNAP_POINTS}
        contentHeight={cancelSheet.height}
        onClose={closeSheet}
        overlay={<WalletPinSheet colors={colors} {...cancel.flow.sheetProps} />}
      >
        {(dismiss) => (
          // Scrolls when taller than the sheet: the buttons stay reachable.
          <BottomSheetScrollView
            showsVerticalScrollIndicator={false}
            onContentSizeChange={cancelSheet.measure}
          >
            {cancel.kind === 'complete' ? (
              <GoalCompleteStep
                colors={colors}
                flow={cancel.flow}
                goal={cancelGoal}
                onDone={dismiss}
                onNotNow={cancel.keep}
                onSignIn={() => signIn(dismiss)}
              />
            ) : (
              <GoalCancelStep
                colors={colors}
                flow={cancel.flow}
                goal={cancelGoal}
                onDone={dismiss}
                onKeep={cancel.keep}
                onSignIn={() => signIn(dismiss)}
              />
            )}
          </BottomSheetScrollView>
        )}
      </SavingsBottomSheet>
    );
  }
  if (!goal) return null;
  if (phoneSwapStep) {
    return (
      <SavingsBottomSheet
        visible={visible}
        colors={colors}
        snapPoints={COMPACT_SNAP_POINTS}
        contentHeight={swapSheet.height}
        onClose={closeSheet}
      >
        <BottomSheetScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={swapSheet.measure}
        >
          <SavingsNoticeCard colors={colors} goalId={goal?.id} inSheet />
          {phoneSwapStep}
        </BottomSheetScrollView>
      </SavingsBottomSheet>
    );
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
      ? isFundedUnsettledGoal(goal)
        ? 'This savings goal is complete.'
        : 'Purchase requested. Your savings have moved to your order.'
      : 'This goal is funded by scheduled auto-debit.';
  const changeDevice = () => {
    clearSavingsNotice();
    onChangeDevice();
  };

  return (
    <SavingsBottomSheet
      visible={visible}
      colors={colors}
      // Nothing saved yet means no progress card: open shorter so the sheet
      // does not end in empty space. It still expands on drag.
      snapPoints={goal.current_amount > 0 ? undefined : COMPACT_SNAP_POINTS}
      contentHeight={mainHeight}
      onClose={closeSheet}
      overlay={overlay}
    >
      {(dismiss) => (
        <>
          <View
            style={styles.header}
            onLayout={(event) =>
              setHeaderHeight(Math.ceil(event.nativeEvent.layout.height))
            }
          >
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
            onContentSizeChange={(_width, height) =>
              setBodyHeight(Math.ceil(height))
            }
          >
            <PiggyvestSlowdownNotice />
            <SavingsNoticeCard colors={colors} goalId={goal?.id} inSheet />
            {/* A top-up started here asks its funding question here. */}
            <WalletFundPromptCard colors={colors} />
            <SavingsGoalSummary
              colors={colors}
              goal={goal}
              // Not while an add is in flight: the Change phone step would
              // replace the sheet and drop the add's PIN prompt.
              onChangeDevice={
                canChangeDevice && !isAdding ? changeDevice : undefined
              }
              onResolveVariant={onResolveVariant}
            />
            {hasPendingContribution ? (
              <WalletPendingSavingsContribution
                colors={colors}
                isChecking={isCheckingContribution || isAdding}
                onCheck={onCheckContribution}
                retry={isContributionRetry}
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
                // An add in flight also hides Cancel/Complete: Cancel would
                // take over the sheet and drop the add's PIN prompt.
                hasPendingContribution={hasPendingContribution || isAdding}
                onCancel={() => cancel.start('cancel')}
                onComplete={() => cancel.start('complete')}
                walletUpdatedAt={walletUpdatedAt}
              />
            </View>
          </BottomSheetScrollView>
        </>
      )}
    </SavingsBottomSheet>
  );
}
