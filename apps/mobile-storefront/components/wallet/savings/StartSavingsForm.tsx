import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { SavingsContributionSection } from './SavingsContributionSection';
import { SavingsSetupHero } from './SavingsSetupHero';
import { StartSavingsProductFields } from './StartSavingsProductFields';
import { savingsCardAccent } from './savings-card-accent';
import { startSavingsStyles as styles } from './start-savings.styles';
import type {
  SavingsSourceMode,
  StartSavingsColors,
} from './start-savings.types';
import type {
  LocalSavingsFormController,
  StartSavingsController,
} from './start-savings-controller.types';

type StartSavingsFormProps = {
  onSearchFocusChange?: (focused: boolean) => void;
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

export function StartSavingsForm(
  props:
    | (StartSavingsFormProps & { mode?: 'plan' })
    | {
        mode: 'draft';
        onSearchFocusChange?: (focused: boolean) => void;
        colors: StartSavingsColors;
        controller: LocalSavingsFormController;
      }
) {
  const [pressed, setPressed] = useState(false);
  const { colors, controller } = props;
  const deviceReady =
    !!controller.selectedProduct &&
    controller.selectedProduct.requiresVariantSelection === false &&
    Number.isFinite(controller.selectedProduct.price) &&
    controller.selectedProduct.price > 0 &&
    !controller.selectedCatalogProduct?.searchPreview;
  const scheduleReady =
    props.mode !== 'draft' &&
    deviceReady &&
    Number.isFinite(props.controller.contributionValue) &&
    props.controller.contributionValue > 0 &&
    (!props.controller.initialContributionEnabled ||
      (Number.isFinite(props.controller.effectiveInitialContribution) &&
        props.controller.effectiveInitialContribution > 0));
  const disabled =
    controller.isSubmitting ||
    (props.mode === 'draft' && !props.controller.canContinue);
  return (
    <>
      <SavingsSetupHero />
      {props.mode === 'draft' ? (
        <Text style={[styles.subheading, { color: colors.textSecondary }]}>
          Only your device choice is saved. Schedule, funding and interest are
          not available in this test.
        </Text>
      ) : null}
      {props.mode === 'draft' ? (
        <>
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>
            Local test · Draft only
          </Text>
          <StartSavingsProductFields
            onSearchFocusChange={props.onSearchFocusChange}
            mode="draft"
            colors={colors}
            controller={props.controller}
          />
        </>
      ) : (
        <>
          <StartSavingsProductFields
            onSearchFocusChange={props.onSearchFocusChange}
            colors={colors}
            controller={props.controller}
          />
          {deviceReady ? (
            <SavingsContributionSection
              colors={colors}
              controller={props.controller}
            />
          ) : null}
          {scheduleReady ? (
            <>
              <SourceModeSection
                colors={colors}
                controller={props.controller}
              />

              <SavingsTermsSection
                colors={colors}
                controller={props.controller}
              />
            </>
          ) : null}
        </>
      )}
      {controller.formError ? (
        <Text style={[styles.errorText, { color: colors.error }]}>
          {controller.formError}
        </Text>
      ) : null}
      {(props.mode === 'draft' ? deviceReady : scheduleReady) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            props.mode === 'draft'
              ? 'Review savings draft'
              : 'Continue savings setup'
          }
          accessibilityState={{
            disabled,
            busy: controller.isSubmitting,
          }}
          onPress={controller.handleContinue}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          disabled={disabled}
          style={[
            styles.primaryButton,
            disabled ? styles.buttonDisabled : null,
            pressed && !disabled && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {controller.isSubmitting
              ? 'Getting things ready…'
              : props.mode === 'draft'
                ? 'Review savings draft'
                : 'Let’s make it happen'}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

function SourceModeSection({ colors, controller }: StartSavingsFormProps) {
  return (
    <View style={[styles.sourceModeCard, savingsCardAccent(colors)]}>
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        03 · Choose how you fund it
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
        {process.env.EXPO_PUBLIC_HOSTED_STOREFRONT !== '1' ? (
          <SourceModeButton
            colors={colors}
            controller={controller}
            label="Auto debit"
            mode="auto_debit"
          />
        ) : null}
      </View>
      <Text style={[styles.sourceModeHint, { color: colors.textSecondary }]}>
        {process.env.EXPO_PUBLIC_HOSTED_STOREFRONT === '1'
          ? 'Auto debit is not available in this staging build. Use manual contributions while we finish card testing.'
          : controller.sourceMode === 'auto_debit'
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
