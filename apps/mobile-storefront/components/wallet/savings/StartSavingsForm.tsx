import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SavingsContributionSection } from './SavingsContributionSection';
import { SavingsHowYouSaveSection } from './SavingsHowYouSaveSection';
import { SavingsSetupHero } from './SavingsSetupHero';
import { SavingsStep } from './SavingsStep';
import { StartSavingsProductFields } from './StartSavingsProductFields';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
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
  const howReady =
    props.mode !== 'draft' &&
    scheduleReady &&
    props.controller.acceptsNonWithdrawableTerms &&
    (!props.controller.askInterest || props.controller.interestChoice !== null);
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
      <View style={styles.steps}>
        <SavingsStep
          colors={colors}
          number={1}
          title={
            props.mode === 'draft'
              ? 'Pick your phone (draft only)'
              : 'Pick your phone'
          }
          state={deviceReady ? 'done' : 'current'}
          last={props.mode === 'draft'}
        >
          {props.mode === 'draft' ? (
            <StartSavingsProductFields
              onSearchFocusChange={props.onSearchFocusChange}
              mode="draft"
              colors={colors}
              controller={props.controller}
            />
          ) : (
            <StartSavingsProductFields
              onSearchFocusChange={props.onSearchFocusChange}
              colors={colors}
              controller={props.controller}
            />
          )}
        </SavingsStep>
        {props.mode === 'draft' ? null : (
          <>
            <SavingsStep
              colors={colors}
              number={2}
              title="Make it a habit"
              state={
                !deviceReady ? 'later' : scheduleReady ? 'done' : 'current'
              }
            >
              <SavingsContributionSection
                colors={colors}
                controller={props.controller}
              />
            </SavingsStep>
            <SavingsStep
              colors={colors}
              number={3}
              title="How you’ll save"
              state={!scheduleReady ? 'later' : howReady ? 'done' : 'current'}
              last
            >
              <SavingsHowYouSaveSection
                colors={colors}
                controller={props.controller}
              />
            </SavingsStep>
          </>
        )}
      </View>
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
