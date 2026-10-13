import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import type {
  ShipmentCompletionMode,
  ShipmentFlowStep,
} from '@/lib/order-shipment';
import { styles } from './ShipmentFlowSheet.styles';

interface ShipmentFlowFooterProps {
  colors: ThemeColors;
  isSubmitting: boolean;
  isPrimaryDisabled?: boolean;
  onBack: () => void;
  onPrimaryAction: () => void;
  primaryActionLabel: string;
  selectedMode: ShipmentCompletionMode;
  showBack: boolean;
  step: ShipmentFlowStep;
}

function getPrimaryIconName(
  step: ShipmentFlowStep,
  selectedMode: ShipmentCompletionMode
): IoniconsIconName {
  if (step === 'details') {
    return 'arrow-forward';
  }

  if (step === 'method' && selectedMode === 'self_fulfillment') {
    return 'bicycle-outline';
  }

  return 'checkmark-circle-outline';
}

export function ShipmentFlowFooter({
  colors,
  isSubmitting,
  isPrimaryDisabled = false,
  onBack,
  onPrimaryAction,
  primaryActionLabel,
  selectedMode,
  showBack,
  step,
}: ShipmentFlowFooterProps) {
  return (
    <View style={styles.footer}>
      {showBack ? (
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
          disabled={isSubmitting}
          onPress={onBack}
          style={({ pressed }) => [
            styles.secondaryButton,
            { backgroundColor: colors.backgroundLight },
            isSubmitting ? styles.secondaryButtonDisabled : null,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
            Back
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityLabel={primaryActionLabel}
        accessibilityRole="button"
        accessibilityState={{
          disabled: isSubmitting || isPrimaryDisabled,
          busy: isSubmitting,
        }}
        disabled={isSubmitting || isPrimaryDisabled}
        onPress={onPrimaryAction}
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: colors.primary },
          showBack ? null : styles.primaryButtonFull,
          isSubmitting || isPrimaryDisabled
            ? styles.primaryButtonDisabled
            : null,
          {
            opacity: isSubmitting || isPrimaryDisabled ? 1 : pressed ? 0.7 : 1,
          },
        ]}
      >
        {isSubmitting ? (
          <ActivityIndicator color={colors.textOnPrimary} size="small" />
        ) : (
          <>
            <Ionicons
              color={colors.textOnPrimary}
              name={getPrimaryIconName(step, selectedMode)}
              size={18}
            />
            <Text
              style={[
                styles.primaryButtonText,
                { color: colors.textOnPrimary },
              ]}
            >
              {primaryActionLabel}
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}
