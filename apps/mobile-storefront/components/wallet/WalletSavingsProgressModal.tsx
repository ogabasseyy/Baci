import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { answerWalletFundPrompt } from './fund/answer-wallet-fund-prompt';
import { WalletFundPromptCard } from './fund/WalletFundPromptCard';
import { PiggyvestSlowdownNotice } from './PiggyvestSlowdownNotice';
import { SavingsBottomSheet } from './SavingsBottomSheet';
import { SavingsGoalSummary } from './SavingsGoalSummary';
import { GoalCancelStep } from './savings/GoalCancelStep';
import { GoalCompleteStep } from './savings/GoalCompleteStep';
import { GoalLifecycleEntry } from './savings/GoalLifecycleEntry';
import { SavingsNoticeCard } from './savings/SavingsNoticeCard';
import { useInSheetGoalCancel } from './savings/use-in-sheet-goal-cancel';
import { usePlanStillSettingUp } from './savings/use-plan-still-setting-up';
import { WalletPinSheet } from './savings/WalletPinSheet';
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
  isFundPending = false,
  onAddAmountChange,
  onAddSavings,
  onChangeDevice,
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
  const colors = {
    ...themeColors,
    primary: BRAND.primary,
    primaryForeground: BRAND.onPrimary,
    primaryLowOpacity: BRAND.primaryAlpha12,
  };
  // Matches the wallet card: "View plan" there means not "Add to savings" here.
  const settingUp = usePlanStillSettingUp(goal);
  const cancel = useInSheetGoalCancel(goal, onRefreshWallet, visible);
  // A funding question still waiting in this sheet is declined on close
  // (Codex): otherwise its funding never settles.
  const closeSheet = () => {
    answerWalletFundPrompt(false);
    onClose();
  };
  // The sheet is sized to what it shows, so it never ends in empty space.
  const [cancelHeight, setCancelHeight] = useState(0);
  const [swapHeight, setSwapHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [bodyHeight, setBodyHeight] = useState(0);
  if (!goal && !cancel.goal) {
    return null;
  }
  if (cancel.goal) {
    const cancelGoal = cancel.goal;
    // Sign in, then come back to this goal's savings sheet.
    const signIn = (dismiss: () => void) => {
      dismiss();
      const back = `/wallet?action=savings&savingsGoalId=${cancelGoal.id}`;
      router.push(`/auth/login?returnTo=${encodeURIComponent(back)}`);
    };
    return (
      <SavingsBottomSheet
        visible={visible}
        colors={colors}
        snapPoints={COMPACT_SNAP_POINTS}
        contentHeight={cancelHeight}
        onClose={() => {
          cancel.closed();
          closeSheet();
        }}
        overlay={<WalletPinSheet colors={colors} {...cancel.flow.sheetProps} />}
      >
        {(dismiss) => (
          // Scrolls if large text or a small screen makes it taller than the
          // sheet can grow, so the buttons always stay reachable.
          <BottomSheetScrollView
            showsVerticalScrollIndicator={false}
            onContentSizeChange={(_width, height) =>
              setCancelHeight(Math.ceil(height))
            }
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
        contentHeight={swapHeight}
        onClose={closeSheet}
      >
        <BottomSheetScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={(_width, height) =>
            setSwapHeight(Math.ceil(height))
          }
        >
          <SavingsNoticeCard colors={colors} goalId={goal?.id} />
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
      ? 'This savings goal is complete.'
      : 'This goal is funded by scheduled auto-debit.';

  return (
    <SavingsBottomSheet
      visible={visible}
      colors={colors}
      // Nothing saved yet means no progress card: open shorter so the sheet
      // does not end in empty space. It still expands on drag.
      snapPoints={goal.current_amount > 0 ? undefined : COMPACT_SNAP_POINTS}
      contentHeight={
        headerHeight > 0 && bodyHeight > 0
          ? headerHeight + HEADER_GAP + bodyHeight
          : undefined
      }
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
            <SavingsNoticeCard colors={colors} goalId={goal?.id} />
            {/* A top-up started here asks its funding question here. */}
            <WalletFundPromptCard colors={colors} />
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
