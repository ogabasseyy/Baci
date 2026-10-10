import { Pressable, Text, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { SavingsAmountInput } from './SavingsAmountInput';
import { SavingsScheduleFields } from './SavingsScheduleFields';
import { SavingsTimelinePreview } from './SavingsTimelinePreview';
import { savingsCardAccent } from './savings-card-accent';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';
export function SavingsContributionSection({
  colors,
  controller,
}: {
  colors: StartSavingsColors;
  controller: StartSavingsController;
}) {
  return (
    <View style={[styles.setupCard, savingsCardAccent(colors)]}>
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        02 · Make it a habit
      </Text>
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
      <SavingsTimelinePreview
        colors={colors}
        targetAmount={controller.targetValue}
        contributionAmount={controller.contributionValue}
        frequency={controller.frequency}
        maturityDate={controller.maturityDate}
        initialContributionEnabled={controller.initialContributionEnabled}
      />
      <Text style={[styles.sectionLabel, { color: colors.text }]}>
        Want to give it a head start?
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
        <SavingsAmountInput
          colors={colors}
          label="Initial contribution amount"
          value={controller.initialContributionAmount}
          onChangeText={controller.setInitialContributionAmount}
        />
      ) : null}
    </View>
  );
}
