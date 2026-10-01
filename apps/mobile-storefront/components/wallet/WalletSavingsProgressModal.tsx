import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';

type WalletColors = (typeof Colors)['light'];

type WalletSavingsProgressModalProps = {
  addAmount: string;
  colors: WalletColors;
  goal: WalletActiveSavingsGoal | null;
  isAdding: boolean;
  onAddAmountChange: (value: string) => void;
  onAddSavings: () => void;
  onChangeDevice: () => void;
  onClose: () => void;
  onFundWallet: () => void;
  visible: boolean;
  walletBalance: number;
};

function getProgress(goal: WalletActiveSavingsGoal) {
  if (goal.target_amount <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, goal.current_amount / goal.target_amount));
}

function getMilestoneLabel(progress: number) {
  if (progress >= 0.75) {
    return 'Maintain the pace';
  }
  if (progress >= 0.5) {
    return "You're halfway there";
  }
  if (progress > 0) {
    return 'Keep the streak alive';
  }
  return 'Start the streak';
}

export function WalletSavingsProgressModal({
  addAmount,
  colors,
  goal,
  isAdding,
  onAddAmountChange,
  onAddSavings,
  onChangeDevice,
  onClose,
  onFundWallet,
  visible,
  walletBalance,
}: WalletSavingsProgressModalProps) {
  if (!goal) {
    return null;
  }

  const progress = getProgress(goal);
  const percent = Math.round(progress * 100);
  const amountLeft = Math.max(0, goal.target_amount - goal.current_amount);
  const canAddToSavings =
    goal.source_mode === 'manual' && goal.status !== 'completed';
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
      onBackdropPress={onClose}
      onRequestClose={onClose}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="radio-button-on" size={16} color={BRAND.primary} />
          <Text style={[styles.title, { color: colors.text }]}>
            Saving streak
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

      <View style={styles.contentRow}>
        <View style={[styles.devicePane, { backgroundColor: colors.card }]}>
          {goal.product_image ? (
            <Image
              accessibilityLabel={goal.title}
              source={createSafeBoundedImageSource({
                height: 170,
                uri: goal.product_image,
                width: 100,
              })}
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
            <Text style={styles.milestoneText}>
              {getMilestoneLabel(progress)}
            </Text>
          </View>

          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Savings streak progress"
            accessibilityValue={{ max: 100, min: 0, now: percent }}
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, { width: `${percent}%` }]}>
              <Text style={styles.progressPercent}>{percent}%</Text>
            </View>
          </View>

          <View style={styles.amountRow}>
            <Text style={styles.amountLeft}>
              {formatNgnCurrency(amountLeft)} left
            </Text>
            <Text
              style={[styles.walletBalance, { color: colors.textSecondary }]}
            >
              {formatNgnCurrency(walletBalance)} wallet
            </Text>
          </View>

          <View style={styles.metaRow}>
            {goal.product_condition ? (
              <Text style={[styles.metaPill, { color: colors.text }]}>
                {goal.product_condition}
              </Text>
            ) : null}
            {goal.product_variant_label ? (
              <Text style={[styles.metaPill, { color: colors.text }]}>
                {goal.product_variant_label}
              </Text>
            ) : null}
          </View>

          {canAddToSavings ? (
            <View style={styles.addSection}>
              <TextInput
                accessibilityLabel="Savings top-up amount"
                value={addAmount}
                onChangeText={onAddAmountChange}
                keyboardType="number-pad"
                placeholder="Amount to add"
                placeholderTextColor={colors.placeholder}
                style={[
                  styles.amountInput,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />
              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fund wallet for savings"
                  onPress={onFundWallet}
                  style={[
                    styles.secondaryButton,
                    { borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[styles.secondaryButtonText, { color: colors.text }]}
                  >
                    Fund wallet
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm savings top-up"
                  accessibilityState={{ busy: isAdding, disabled: isAdding }}
                  disabled={isAdding}
                  onPress={onAddSavings}
                  style={[
                    styles.primaryButton,
                    isAdding ? styles.disabledButton : null,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    {isAdding ? 'Adding...' : 'Vex and Pay!'}
                  </Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change savings device"
                onPress={onChangeDevice}
                style={[
                  styles.changeDeviceButton,
                  { borderColor: colors.border },
                ]}
              >
                <Ionicons
                  name="swap-horizontal-outline"
                  size={16}
                  color={colors.text}
                />
                <Text
                  style={[
                    styles.changeDeviceButtonText,
                    { color: colors.text },
                  ]}
                >
                  Change device
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text
              style={[styles.autoDebitHint, { color: colors.textSecondary }]}
            >
              {unavailableContributionMessage}
            </Text>
          )}
        </View>
      </View>
    </ModalSheet>
  );
}
