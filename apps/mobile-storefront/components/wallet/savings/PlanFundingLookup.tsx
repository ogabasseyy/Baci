import { Pressable, Text, TextInput, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { TransferModalProps } from './start-savings-transfer-modal-props';

export function PlanFundingLookup({
  bvn,
  colors,
  controller,
  earnInterest,
  isHostedStaging = false,
  onBvnChange,
  onCheckStatus,
  onEarnInterestChange,
  onFetch,
}: Pick<TransferModalProps, 'colors'> & {
  controller: Pick<
    TransferModalProps['controller'],
    | 'planFundingPhase'
    | 'planFundingRequiresBvn'
    | 'planFundingError'
    | 'isSubmitting'
  >;
  bvn: string;
  earnInterest: boolean;
  isHostedStaging?: boolean;
  onBvnChange: (value: string) => void;
  onCheckStatus?: () => void;
  onEarnInterestChange: (value: boolean) => void;
  onFetch: () => void;
}) {
  const isLoading = controller.planFundingPhase === 'loading';
  const statusOnly =
    isHostedStaging && controller.planFundingRequiresBvn !== false;
  const disabled =
    controller.isSubmitting || isLoading || (statusOnly && !onCheckStatus);
  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.transferMetaLabel, { color: colors.textSecondary }]}>
        {statusOnly
          ? 'This plan needs an identity check that approved operators complete in the test environment. Ask an operator to continue, then check the account status again.'
          : controller.planFundingRequiresBvn === false
            ? 'Use your verified PiggyVest profile to check that this plan is ready. Choose whether to request interest on this plan.'
            : 'Enter the 11-digit BVN linked to this plan to check that this plan is ready. It is used once for this check and never stored. Plans are funded from your wallet, so no account number is shown.'}
      </Text>
      {!statusOnly && controller.planFundingRequiresBvn !== false ? (
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
      ) : null}
      {!statusOnly ? (
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
      ) : null}
      {controller.planFundingError ? (
        <Text style={[styles.errorText, { color: colors.error }]}>
          {controller.planFundingError}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          statusOnly ? 'Check account status' : 'Check plan readiness'
        }
        accessibilityState={{ disabled }}
        disabled={disabled}
        style={[
          styles.secondaryButton,
          { borderColor: BRAND.primary, backgroundColor: BRAND.primary },
          disabled ? styles.buttonDisabled : null,
        ]}
        onPress={statusOnly ? onCheckStatus : onFetch}
      >
        <Text style={[styles.secondaryButtonText, { color: palette.white }]}>
          {isLoading
            ? 'Loading…'
            : statusOnly
              ? 'Check account status'
              : 'Check plan readiness'}
        </Text>
      </Pressable>
    </View>
  );
}
