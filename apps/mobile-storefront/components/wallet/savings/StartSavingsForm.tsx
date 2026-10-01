import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, TextInput, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { PlanWalletStagingSection } from './PlanWalletStagingSection';
import { StartSavingsProductFields } from './StartSavingsProductFields';
import { themedInputStyle } from './start-savings.helpers';
import { startSavingsStyles as styles } from './start-savings.styles';
import type {
  SavingsSourceMode,
  StartSavingsColors,
} from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

type StartSavingsFormProps = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

export function StartSavingsForm({
  colors,
  controller,
}: StartSavingsFormProps) {
  return (
    <>
      <Text style={[styles.heading, { color: colors.text }]}>
        Start Savings
      </Text>
      <Text style={[styles.subheading, { color: colors.textSecondary }]}>
        Set up a device savings plan for your next purchase.
      </Text>
      <StartSavingsProductFields colors={colors} controller={controller} />
      <ContributionSection colors={colors} controller={controller} />
      <SourceModeSection colors={colors} controller={controller} />
      <PlanWalletStagingSection
        colors={colors}
        targetKobo={Math.round((controller.targetValue || 0) * 100)}
      />
      <SavingsTermsSection colors={colors} controller={controller} />
      {controller.formError ? (
        <Text style={[styles.errorText, { color: colors.error }]}>
          {controller.formError}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue savings setup"
        accessibilityState={{
          disabled: controller.isSubmitting,
          busy: controller.isSubmitting,
        }}
        onPress={controller.handleContinue}
        disabled={controller.isSubmitting}
        style={({ pressed }) => [
          styles.primaryButton,
          controller.isSubmitting ? styles.buttonDisabled : null,
          pressed && !controller.isSubmitting && { opacity: 0.7 },
        ]}
      >
        <Text style={styles.primaryButtonText}>Continue</Text>
      </Pressable>
    </>
  );
}

function ContributionSection({ colors, controller }: StartSavingsFormProps) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        Contribution amount
      </Text>
      <TextInput
        accessibilityLabel="Savings contribution amount"
        value={controller.contributionAmount}
        onChangeText={controller.setContributionAmount}
        keyboardType="number-pad"
        placeholder="Enter amount"
        placeholderTextColor={colors.placeholder}
        style={[styles.input, themedInputStyle(colors)]}
      />
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        Are you making an initial contribution?
      </Text>
      <View style={styles.radioRow}>
        {[
          { label: 'Yes', value: true },
          { label: 'No', value: false },
        ].map((option) => (
          <Pressable
            key={option.label}
            accessibilityRole="radio"
            accessibilityLabel={`Initial contribution ${option.label}`}
            accessibilityState={{
              selected: option.value === controller.initialContributionEnabled,
            }}
            onPress={() =>
              controller.setInitialContributionEnabled(option.value)
            }
            style={styles.radioOption}
          >
            <View
              style={[
                styles.radioDot,
                {
                  borderColor:
                    option.value === controller.initialContributionEnabled
                      ? BRAND.primary
                      : colors.border,
                  backgroundColor:
                    option.value === controller.initialContributionEnabled
                      ? BRAND.primary
                      : colors.card,
                },
              ]}
            />
            <Text style={{ color: colors.text }}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {controller.initialContributionEnabled ? (
        <TextInput
          accessibilityLabel="Initial contribution amount"
          value={controller.initialContributionAmount}
          onChangeText={controller.setInitialContributionAmount}
          keyboardType="number-pad"
          placeholder="Enter initial contribution"
          placeholderTextColor={colors.placeholder}
          style={[styles.input, themedInputStyle(colors)]}
        />
      ) : null}
    </View>
  );
}

function SourceModeSection({ colors, controller }: StartSavingsFormProps) {
  return (
    <View
      style={[
        styles.sourceModeCard,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
    >
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        Set primary source of funds
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Savings source of funds"
        style={styles.sourceModeRow}
      >
        <SourceModeButton
          colors={colors}
          controller={controller}
          label="Manual debit"
          mode="manual"
        />
        <SourceModeButton
          colors={colors}
          controller={controller}
          label="Auto debit"
          mode="auto_debit"
        />
      </View>
      <Text style={[styles.sourceModeHint, { color: colors.textSecondary }]}>
        {controller.sourceMode === 'auto_debit'
          ? 'Charges will use a saved Paystack card for scheduled contributions.'
          : 'Manual debit uses wallet balance or wallet funding before the plan starts.'}
      </Text>
    </View>
  );
}

function SourceModeButton({
  colors,
  controller,
  label,
  mode,
}: StartSavingsFormProps & {
  label: string;
  mode: SavingsSourceMode;
}) {
  const isActive = controller.sourceMode === mode;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Use ${label.toLowerCase()} for savings`}
      accessibilityState={{ selected: isActive }}
      onPress={() => controller.handleSourceModeChange(mode)}
      style={[
        styles.sourceModeOption,
        {
          borderColor: isActive ? BRAND.primary : colors.border,
          backgroundColor: isActive ? `${BRAND.primary}10` : colors.background,
        },
      ]}
    >
      <Text
        style={[
          styles.sourceModeLabel,
          { color: isActive ? BRAND.primary : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SavingsTermsSection({ colors, controller }: StartSavingsFormProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: controller.acceptsNonWithdrawableTerms }}
      accessibilityLabel="Accept non-withdrawable savings terms"
      onPress={() =>
        controller.setAcceptsNonWithdrawableTerms((value) => !value)
      }
      style={styles.checkbox}
    >
      <View
        style={[
          styles.checkboxMark,
          {
            borderColor: controller.acceptsNonWithdrawableTerms
              ? BRAND.primary
              : colors.border,
            backgroundColor: controller.acceptsNonWithdrawableTerms
              ? BRAND.primary
              : colors.card,
          },
        ]}
      >
        {controller.acceptsNonWithdrawableTerms ? (
          <Ionicons name="checkmark" size={12} color={palette.white} />
        ) : null}
      </View>
      <Text style={[styles.checkboxLabel, { color: colors.textSecondary }]}>
        I understand savings are reserved for my selected purchase and cannot be
        withdrawn to a bank account.
      </Text>
    </Pressable>
  );
}
