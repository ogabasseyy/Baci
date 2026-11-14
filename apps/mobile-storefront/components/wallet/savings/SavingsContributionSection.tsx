import { Text, View } from 'react-native';
import { SavingsAmountInput } from './SavingsAmountInput';
import { SavingsChoiceCards } from './SavingsChoiceCards';
import { SavingsIconLabel } from './SavingsIconLabel';
import { SavingsScheduleFields } from './SavingsScheduleFields';
import { SavingsTimelinePreview } from './SavingsTimelinePreview';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';
import {
  contributionAboveTargetMessage,
  HEAD_START_ABOVE_TARGET_MESSAGE,
} from './start-savings-controller.utils';

const HEAD_START_OPTIONS = [
  {
    value: true,
    label: 'Yes',
    accessibilityLabel: 'Initial contribution Yes',
    icon: 'flash-outline',
  },
  {
    value: false,
    label: 'No',
    accessibilityLabel: 'Initial contribution No',
    icon: 'calendar-outline',
  },
] as const;

/** Step 2: how often and how much, the timeline, and an optional head start. */
export function SavingsContributionSection({
  colors,
  controller,
}: {
  colors: StartSavingsColors;
  controller: StartSavingsController;
}) {
  const tooBig = contributionAboveTargetMessage(
    controller.contributionValue,
    controller.targetValue
  );
  // Same rule the step's Continue uses: say why a head start blocks it.
  const headStartTooBig =
    controller.initialContributionEnabled &&
    Number.isFinite(controller.effectiveInitialContribution) &&
    Number.isFinite(controller.targetValue) &&
    controller.targetValue > 0 &&
    controller.effectiveInitialContribution > controller.targetValue;
  return (
    <View style={styles.section}>
      <SavingsScheduleFields colors={colors} controller={controller} />
      <Text style={[styles.subheading, { color: colors.textSecondary }]}>
        Pick an amount that works for you, {controller.frequency}.
      </Text>
      <SavingsAmountInput
        colors={colors}
        label="Savings contribution amount"
        value={controller.contributionAmount}
        onChangeText={controller.setContributionAmount}
      />
      {tooBig ? (
        <Text
          accessibilityRole="alert"
          style={[styles.fieldWarning, { color: colors.error }]}
        >
          {tooBig}
        </Text>
      ) : (
        <SavingsTimelinePreview
          colors={colors}
          targetAmount={controller.targetValue}
          contributionAmount={controller.contributionValue}
          frequency={controller.frequency}
          maturityDate={controller.maturityDate}
          initialContributionEnabled={controller.initialContributionEnabled}
        />
      )}
      <SavingsIconLabel
        icon="rocket-outline"
        text="Want to give it a head start?"
        color={colors.text}
      />
      <Text style={[styles.subheading, { color: colors.textSecondary }]}>
        A little extra now gets you to your phone sooner.
      </Text>
      <SavingsChoiceCards
        accessibilityLabel="Give it a head start"
        colors={colors}
        options={HEAD_START_OPTIONS}
        selected={controller.initialContributionEnabled}
        onSelect={controller.setInitialContributionEnabled}
      />
      {controller.initialContributionEnabled ? (
        <SavingsAmountInput
          colors={colors}
          label="Initial contribution amount"
          value={controller.initialContributionAmount}
          onChangeText={controller.setInitialContributionAmount}
        />
      ) : null}
      {headStartTooBig ? (
        <Text
          accessibilityRole="alert"
          style={[styles.fieldWarning, { color: colors.error }]}
        >
          {HEAD_START_ABOVE_TARGET_MESSAGE}
        </Text>
      ) : null}
    </View>
  );
}
