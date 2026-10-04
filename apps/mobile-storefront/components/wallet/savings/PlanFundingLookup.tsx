import { Pressable, Text, TextInput, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { TransferModalProps } from './start-savings-transfer-modal-props';

export function PlanFundingLookup({
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
