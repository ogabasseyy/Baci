import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { formatProductConditionDisplay } from '@/types/product';
import { getSavingsGoalImageSource } from './get-savings-goal-image-source';
import { getSavingsProgress } from './get-savings-progress';
import { WalletPendingSavingsContribution } from './WalletPendingSavingsContribution';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';
import { WalletSavingsPlanFunding } from './WalletSavingsPlanFunding';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';

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
  visible: boolean;
  walletBalance: number;
};

export function WalletSavingsProgressModal({
  addAmount,
  colors,
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
  visible,
  walletBalance,
}: WalletSavingsProgressModalProps) {
  if (!goal) {
    return null;
  }

  const { milestone, percent } = getSavingsProgress(goal);
  const amountLeft = Math.max(0, goal.target_amount - goal.current_amount);
  const conditionLabel = formatProductConditionDisplay(goal.product_condition);
  const productImageSource = getSavingsGoalImageSource(goal, 170);
  const usesPlanFunding = isHostedStagingTestPaymentsEnabled();
  const canAddToSavings =
    (goal.source_mode === 'manual' || usesPlanFunding) &&
    goal.status !== 'completed';
  const unavailableContributionMessage =
    goal.status === 'completed'
      ? 'This savings goal is complete.'
      : 'This goal is funded by scheduled auto-debit.';

  return (
    <ModalSheet
      visible={visible}
      animationType="slide"
      backdropStyle={styles.backdrop}
      cardStyle={[styles.card, { backgroundColor: colors.background }]}
      keyboardAutomaticOffset
      keyboardSurfaceColor={colors.background}
      onBackdropPress={onClose}
      onRequestClose={onClose}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]}>
            {canAddToSavings ? 'Add to savings' : 'Your savings plan'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close savings progress"
          onPress={onClose}
          style={styles.iconButton}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.contentRow}>
          <View style={[styles.devicePane, { backgroundColor: colors.card }]}>
            {productImageSource ? (
              <Image
                accessibilityLabel={goal.title}
                source={productImageSource}
                style={styles.deviceImage}
                contentFit="contain"
                autoplay={false}
              />
            ) : (
              <View style={styles.devicePlaceholder}>
                <Ionicons
                  name="phone-portrait-outline"
                  size={42}
                  color={colors.textSecondary}
                />
              </View>
            )}
          </View>

          <View style={styles.progressPane}>
            <View style={styles.milestoneRow}>
              <Text style={[styles.goalTitle, { color: colors.text }]}>
                {goal.title}
              </Text>
              <Text
                style={[styles.milestoneText, { color: colors.textSecondary }]}
              >
                {milestone}
              </Text>
            </View>

            <View style={styles.metaRow}>
              {conditionLabel ? (
                <Text
                  style={[
                    styles.metaPill,
                    { backgroundColor: colors.muted, color: colors.text },
                  ]}
                >
                  Condition: {conditionLabel}
                </Text>
              ) : null}
              {goal.product_variant_label ? (
                <Text
                  style={[
                    styles.metaPill,
                    { backgroundColor: colors.muted, color: colors.text },
                  ]}
                >
                  {goal.product_variant_label}
                </Text>
              ) : null}
            </View>
            {goal.selection_unresolved ? (
              <Text
                style={[styles.autoDebitHint, { color: colors.textSecondary }]}
              >
                Choose the exact device variant before buying. This plan does
                not guess a model, storage or colour.
              </Text>
            ) : null}
            {goal.status === 'completed' &&
            goal.selection_unresolved &&
            goal.variant_resolution_options?.length ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Resolve savings device variant"
                onPress={onResolveVariant}
                style={[
                  styles.changeDeviceButton,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.changeDeviceButtonText,
                    { color: colors.text },
                  ]}
                >
                  Choose exact variant
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <View
          style={[
            styles.progressCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.amountRow}>
            <Text style={[styles.amountLeft, { color: colors.text }]}>
              {formatNgnCurrency(goal.current_amount)} saved
            </Text>
            <Text
              style={[styles.walletBalance, { color: colors.textSecondary }]}
            >
              {formatNgnCurrency(goal.target_amount)} target
            </Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Savings plan progress details"
            accessibilityValue={{ max: 100, min: 0, now: percent }}
            style={[
              styles.progressTrack,
              { backgroundColor: colors.primaryLowOpacity },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${percent}%`, backgroundColor: colors.primary },
              ]}
            />
          </View>
          <View style={styles.amountRow}>
            <Text
              style={[styles.walletBalance, { color: colors.textSecondary }]}
            >
              {formatNgnCurrency(amountLeft)} left
            </Text>
            <Text
              style={[styles.walletBalance, { color: colors.textSecondary }]}
            >
              <Text style={{ color: colors.primary }}>{percent}%</Text> complete
            </Text>
          </View>
        </View>
        {hasPendingContribution ? (
          <WalletPendingSavingsContribution
            colors={colors}
            isChecking={isAdding}
            onCheck={onAddSavings}
          />
        ) : canAddToSavings && usesPlanFunding ? (
          visible ? (
            <WalletSavingsPlanFunding
              key={goal.id}
              addAmount={addAmount}
              colors={colors}
              goal={goal}
              onAddAmountChange={onAddAmountChange}
              onRefreshWallet={onRefreshWallet}
            />
          ) : null
        ) : canAddToSavings ? (
          <WalletSavingsContributionFlow
            addAmount={addAmount}
            colors={colors}
            isAdding={isAdding}
            isFundPending={isFundPending}
            onAddAmountChange={onAddAmountChange}
            onAddSavings={onAddSavings}
            onFundWallet={onFundWallet}
            remainingAmount={amountLeft}
            walletBalance={walletBalance}
          />
        ) : (
          <Text style={[styles.autoDebitHint, { color: colors.textSecondary }]}>
            {unavailableContributionMessage}
          </Text>
        )}
        {canAddToSavings ||
        (goal.selection_unresolved &&
          (goal.status !== 'completed' ||
            !goal.variant_resolution_options?.length)) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change savings device"
            onPress={onChangeDevice}
            style={[styles.changeDeviceButton, { borderColor: colors.border }]}
          >
            <Ionicons
              name="swap-horizontal-outline"
              size={16}
              color={colors.text}
            />
            <Text
              style={[styles.changeDeviceButtonText, { color: colors.text }]}
            >
              Change device
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ModalSheet>
  );
}
