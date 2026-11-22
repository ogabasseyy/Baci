import { Pressable, Text, View } from 'react-native';
import { oxygenBirthCalendarStyles as styles } from './OxygenBirthCalendarSheet.styles';
import { useOxygenColors } from './OxygenFormPrimitives';
import {
  OXYGEN_BIRTH_MONTHS,
  oxygenBirthDateValue,
  oxygenBirthMonthDays,
} from './oxygen-birth-calendar';

export function OxygenBirthCalendarGrid({
  mode,
  year,
  month,
  yearStart,
  selection,
  today,
  onYear,
  onMonth,
  onDay,
}: {
  mode: 'days' | 'months' | 'years';
  year: number;
  month: number;
  yearStart: number;
  selection?: string;
  today: Date;
  onYear: (year: number) => void;
  onMonth: (month: number) => void;
  onDay: (date: string) => void;
}) {
  const colors = useOxygenColors();
  const years = Array.from(
    { length: 12 },
    (_, index) => yearStart + index
  ).filter((item) => item <= today.getFullYear());
  return mode === 'days' ? (
    <View style={styles.calendar}>
      <View style={styles.grid}>
        {[
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
          'Sunday',
        ].map((day) => (
          <View key={day} style={styles.dayCell}>
            <Text style={[styles.weekday, { color: colors.textSecondary }]}>
              {day.slice(0, 1)}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.grid}>
        {oxygenBirthMonthDays(year, month).map((day, index) => {
          if (!day)
            // biome-ignore lint/suspicious/noArrayIndexKey: Empty fixed calendar slots have no state or identity.
            return <View key={`empty-${index}`} style={styles.dayCell} />;
          const date = oxygenBirthDateValue(year, month, day);
          const disabled = new Date(year, month, day) > today;
          const selected = selection === date;
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityLabel={`${day} ${OXYGEN_BIRTH_MONTHS[month]} ${year}`}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onDay(date)}
              style={styles.dayCell}
            >
              <View
                style={[
                  styles.dayCircle,
                  {
                    backgroundColor: selected ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    {
                      color: disabled
                        ? colors.placeholder
                        : selected
                          ? colors.primaryForeground
                          : colors.text,
                      opacity: disabled ? 0.4 : 1,
                    },
                  ]}
                >
                  {day}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : (
    <View style={styles.calendar}>
      <Text style={[styles.gridCaption, { color: colors.textSecondary }]}>
        {mode === 'years'
          ? `${yearStart} – ${Math.min(yearStart + 11, today.getFullYear())}`
          : 'Choose your birth month'}
      </Text>
      <View style={styles.grid}>
        {(mode === 'years' ? years : OXYGEN_BIRTH_MONTHS).map((item, index) => {
          const disabled =
            mode === 'months' &&
            year === today.getFullYear() &&
            index > today.getMonth();
          const selected = mode === 'years' ? item === year : index === month;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityLabel={String(item)}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() =>
                mode === 'years' ? onYear(Number(item)) : onMonth(index)
              }
              style={[
                styles.gridOption,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected
                    ? colors.primaryLowOpacity
                    : colors.card,
                  opacity: disabled ? 0.4 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  { color: selected ? colors.primary : colors.text },
                ]}
              >
                {mode === 'months' ? String(item).slice(0, 3) : item}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
