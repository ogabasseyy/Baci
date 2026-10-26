import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DraggableModalSheet } from '@/components/ui/DraggableModalSheet';
import { BRAND, type default as Colors, withAlpha } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { formatProductConditionDisplay } from '@/types/product';
import { getSavingsGoalImageSource } from './get-savings-goal-image-source';
import { getSavingsProgress } from './get-savings-progress';
import { WalletSavingsContributionSection } from './WalletSavingsContributionSection';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';

type WalletColors = (typeof Colors)['light'];

type WalletSavingsProgressModalProps = {
  embedded?: boolean;
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
  usesWalletBankTransfer?: boolean;
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
  usesWalletBankTransfer = false,
  embedded = false,
}: WalletSavingsProgressModalProps) {
  const insets = useSafeAreaInsets();
  if (!goal) {
    return null;
  }

  const { milestone, percent, percentLabel } = getSavingsProgress(goal);
  const progressValue = { max: 100, min: 0, now: percent, text: percentLabel };
  const amountLeft = Math.max(0, goal.target_amount - goal.current_amount);
  const conditionLabel = formatProductConditionDisplay(goal.product_condition);
  const productImageSource = getSavingsGoalImageSource(goal, 170);
  const usesPlanFunding =
    !usesWalletBankTransfer && isHostedStagingTestPaymentsEnabled();
  const canAddToSavings =
    (goal.source_mode === 'manual' || usesPlanFunding) &&
    goal.status !== 'completed';

  return (
    <DraggableModalSheet
      embedded={embedded}
      visible={visible}
      backgroundColor={colors.background}
      borderColor={BRAND.primary}
      handleColor={BRAND.primary}
      onClose={onClose}
    >
      <View
        style={[
          styles.header,
          canAddToSavings && { justifyContent: 'flex-end' },
        ]}
      >
        {!canAddToSavings ? (
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]}>
              Your savings plan
            </Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close savings progress"
          onPress={onClose}
          style={styles.iconButton}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <BottomSheetScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
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
              <Text
                style={[styles.goalTitle, { color: colors.text }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
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
              {goal.product_variant_label?.split('·').map((attribute) => (
                <Text
                  key={attribute}
                  style={[
                    styles.metaPill,
                    { backgroundColor: colors.muted, color: colors.text },
                  ]}
                >
                  {attribute.trim()}
                </Text>
              ))}
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
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Savings plan progress details"
            accessibilityValue={progressValue}
            style={[
              styles.progressTrack,
              { backgroundColor: withAlpha(BRAND.primary, 0.16) },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${percent}%`, backgroundColor: BRAND.primary },
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
              <Text style={{ color: BRAND.primary }}>{percentLabel}</Text>{' '}
              complete
            </Text>
          </View>
        </View>
        <WalletSavingsContributionSection
          addAmount={addAmount}
          colors={colors}
          isAdding={isAdding}
          isFundPending={isFundPending}
          onAddAmountChange={onAddAmountChange}
          onAddSavings={onAddSavings}
          onFundWallet={onFundWallet}
          remainingAmount={amountLeft}
          walletBalance={walletBalance}
          goal={goal}
          canAdd={canAddToSavings}
          hasPendingContribution={hasPendingContribution}
          usesPlanFunding={usesPlanFunding}
          usesWalletBankTransfer={usesWalletBankTransfer}
          visible={visible}
          onRefreshWallet={onRefreshWallet}
        />
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
      </BottomSheetScrollView>
    </DraggableModalSheet>
  );
}

import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
