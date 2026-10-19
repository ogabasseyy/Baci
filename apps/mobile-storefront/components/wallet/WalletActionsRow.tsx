import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { styles } from './wallet.styles';

type WalletColors = (typeof Colors)['light'];

type WalletActionsRowProps = {
  hasSavedCards?: boolean;
  colors: WalletColors;
  hasActiveSavingsGoal: boolean;
  needsVariantResolution?: boolean;
  onManageCards: () => void;
  onQuickSave: () => void;
  onStartSavings: () => void;
  showPrimaryAction?: boolean;
  showQuickSave: boolean;
};

export function WalletActionsRow({
  hasSavedCards = false,
  colors,
  hasActiveSavingsGoal,
  needsVariantResolution = false,
  onManageCards,
  onQuickSave,
  onStartSavings,
  showPrimaryAction = true,
  showQuickSave,
}: WalletActionsRowProps) {
  const primaryActionLabel = needsVariantResolution
    ? 'Choose exact variant'
    : hasActiveSavingsGoal
      ? 'Add to Savings'
      : 'Start Savings';

  return (
    <>
      {showPrimaryAction || hasSavedCards ? (
        <View style={styles.primaryActionRow}>
          {showPrimaryAction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={primaryActionLabel}
              onPress={onStartSavings}
              style={styles.primaryActionButton}
            >
              <Ionicons
                name="sparkles-outline"
                size={16}
                color={colors.white}
              />
              <Text style={styles.primaryActionButtonText}>
                {primaryActionLabel}
              </Text>
            </Pressable>
          ) : null}
          {hasSavedCards ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Manage Cards"
              onPress={onManageCards}
              style={[
                styles.secondaryActionButton,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Ionicons name="card-outline" size={16} color={colors.text} />
              <Text
                style={[
                  styles.secondaryActionButtonText,
                  { color: colors.text },
                ]}
              >
                Manage Cards
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {showQuickSave ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quick Save"
          style={styles.quickSaveButton}
          onPress={onQuickSave}
        >
          <Ionicons name="add-circle-outline" size={16} color={colors.white} />
          <Text style={styles.quickSaveButtonText}>Quick Save</Text>
        </Pressable>
      ) : null}
    </>
  );
}
