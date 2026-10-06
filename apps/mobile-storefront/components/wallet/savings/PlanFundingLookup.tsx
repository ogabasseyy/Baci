import { Pressable, Text, TextInput, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { TransferModalProps } from './start-savings-transfer-modal-props';

export function PlanFundingLookup({
  bvn,
  colors,
  controller,
  earnInterest,
  isHostedStaging,
  onBvnChange,
  onCheckStatus,
  onEarnInterestChange,
  onFetch,
}: TransferModalProps & {
  bvn: string;
  earnInterest: boolean;
  isHostedStaging: boolean;
  onBvnChange: (value: string) => void;
  onCheckStatus: () => void;
  onEarnInterestChange: (value: boolean) => void;
  onFetch: () => void;
}) {
  const isLoading = controller.planFundingPhase === 'loading';
  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.transferMetaLabel, { color: colors.textSecondary }]}>
        {isHostedStaging
          ? 'This plan needs an identity check that approved operators complete in the test environment. Ask an operator to continue, then check the account status again.'
          : 'Enter the 11-digit BVN linked to this plan to reveal its dedicated account. It is used once to prepare the transfer and never stored.'}
      </Text>
      {isHostedStaging ? null : (
        <>
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
                <Text style={{ color: palette.white, fontWeight: '700' }}>
                  ✓
                </Text>
              ) : null}
            </View>
            <Text style={[styles.transferMetaLabel, { color: colors.text }]}>
              Earn interest on this plan
            </Text>
          </Pressable>
        </>
      )}
      {controller.planFundingError ? (
        <Text style={[styles.errorText, { color: colors.error }]}>
          {controller.planFundingError}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isHostedStaging ? 'Check account status' : 'Show plan account'
        }
        accessibilityState={{ disabled: controller.isSubmitting || isLoading }}
        disabled={controller.isSubmitting || isLoading}
        style={[
          styles.secondaryButton,
          { borderColor: BRAND.primary, backgroundColor: BRAND.primary },
          controller.isSubmitting || isLoading ? styles.buttonDisabled : null,
        ]}
        onPress={isHostedStaging ? onCheckStatus : onFetch}
      >
        <Text style={[styles.secondaryButtonText, { color: palette.white }]}>
          {isLoading
            ? 'Loading…'
            : isHostedStaging
              ? 'Check account status'
              : 'Show plan account'}
        </Text>
      </Pressable>
    </View>
  );
}
