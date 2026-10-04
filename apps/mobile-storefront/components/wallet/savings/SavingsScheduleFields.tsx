import { Pressable, Text, View } from 'react-native';
import { DateTimePickerField } from '@/components/ui/DateTimePickerField';
import { BRAND, palette } from '@/constants/Colors';
import { SAVINGS_FREQUENCIES, themedInputStyle } from './start-savings.helpers';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';
export function SavingsScheduleFields({
  colors,
  controller,
}: {
  colors: StartSavingsColors;
  controller: StartSavingsController;
}) {
  return (
    <>
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: colors.text }]}>
          Find your rhythm
        </Text>
        <View style={styles.frequencyRow}>
          {SAVINGS_FREQUENCIES.map((option) => {
            const isActive = controller.frequency === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${option} savings frequency`}
                accessibilityState={{ selected: isActive }}
                onPress={() => controller.setFrequency(option)}
                style={[
                  styles.frequencyOption,
                  {
                    backgroundColor: isActive ? BRAND.primary : colors.card,
                    borderColor: isActive ? BRAND.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.frequencyOptionLabel,
                    { color: isActive ? palette.white : colors.text },
                  ]}
                >
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <DateAndAmountInputs colors={colors} controller={controller} />
    </>
  );
}

function DateAndAmountInputs({
  colors,
  controller,
}: {
  colors: StartSavingsColors;
  controller: StartSavingsController;
}) {
  return (
    <View style={styles.row}>
      <DateTimePickerField
        accessibilityLabel="Savings debit time"
        displayFormattedValue
        fallbackDisplay="06:20"
        fieldStyle={[styles.pickerField, themedInputStyle(colors)]}
        label="Preferred debit time"
        labelStyle={[styles.sectionLabel, { color: colors.text }]}
        mode="time"
        onChangeText={controller.setPreferredDebitTime}
        textStyle={[styles.pickerFieldText, { color: colors.text }]}
        value={controller.preferredDebitTime}
        wrapperStyle={styles.rowItem}
      />
      <DateTimePickerField
        accessibilityLabel="Savings start date"
        displayFormattedValue
        fallbackDisplay="YYYY-MM-DD"
        fieldStyle={[styles.pickerField, themedInputStyle(colors)]}
        label="Start date"
        labelStyle={[styles.sectionLabel, { color: colors.text }]}
        mode="date"
        onChangeText={controller.setStartDate}
        textStyle={[styles.pickerFieldText, { color: colors.text }]}
        value={controller.startDate}
        wrapperStyle={styles.rowItem}
      />
    </View>
  );
}
