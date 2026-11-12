import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { SavingsBottomSheet } from './SavingsBottomSheet';
import { SavingsGoalSummary } from './SavingsGoalSummary';
import { GoalCancelStep } from './savings/GoalCancelStep';
import { GoalCompleteStep } from './savings/GoalCompleteStep';
import { GoalLifecycleEntry } from './savings/GoalLifecycleEntry';
import { useInSheetGoalCancel } from './savings/use-in-sheet-goal-cancel';
import { WalletPinSheet } from './savings/WalletPinSheet';
import { WalletPendingSavingsContribution } from './WalletPendingSavingsContribution';
import { WalletSavingsFundingSection } from './WalletSavingsFundingSection';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';

const COMPACT_SNAP_POINTS = ['64%', '92%'];
/** The header's bottom margin (SPACING.md), outside its measured height. */
const HEADER_GAP = 16;

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
  /** Change phone, shown in this same sheet in place of the savings view. */
  phoneSwapStep?: ReactNode;
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
  const cancel = useInSheetGoalCancel(goal, onRefreshWallet);
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
    return (
      <SavingsBottomSheet
        visible={visible}
        colors={colors}
        snapPoints={COMPACT_SNAP_POINTS}
        contentHeight={cancelHeight}
        onClose={() => {
          cancel.closed();
          onClose();
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
                onSignIn={() => {
                  dismiss();
                  router.push('/auth/login?returnTo=%2Fwallet');
                }}
              />
            ) : (
              <GoalCancelStep
                colors={colors}
                flow={cancel.flow}
                goal={cancelGoal}
                onDone={dismiss}
                onKeep={cancel.keep}
                onSignIn={() => {
                  dismiss();
                  router.push('/auth/login?returnTo=%2Fwallet');
                }}
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
        onClose={onClose}
      >
        <BottomSheetScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={(_width, height) =>
            setSwapHeight(Math.ceil(height))
          }
        >
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
      onClose={onClose}
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
                  name={canAddToSavings ? 'wallet-outline' : 'flag-outline'}
                  size={16}
                  color={colors.primary}
                />
              </View>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: colors.primary }]}
              >
                {canAddToSavings ? 'Add to savings' : 'Your savings plan'}
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
