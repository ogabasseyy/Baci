import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { OxygenBirthCalendarGrid } from './OxygenBirthCalendarGrid';
import { oxygenBirthCalendarStyles as styles } from './OxygenBirthCalendarSheet.styles';
import { OxygenBirthDateEditor } from './OxygenBirthDateEditor';
import { OxygenButton, useOxygenColors } from './OxygenFormPrimitives';
import {
  OXYGEN_BIRTH_MONTHS,
  readOxygenBirthDate,
} from './oxygen-birth-calendar';

export function OxygenBirthCalendarSheet({
  value,
  onSelect,
  onClose,
}: {
  value?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const colors = useOxygenColors();
  const insets = useSafeAreaInsets();
  const [today] = useState(() => new Date());
  const initial = readOxygenBirthDate(value, today);
  const [year, setYear] = useState(
    initial?.getFullYear() ?? today.getFullYear() - 30
  );
  const [month, setMonth] = useState(initial?.getMonth() ?? 0);
  const [selection, setSelection] = useState(initial ? value : undefined);
  function selectDate(next?: string) {
    setSelection(next);
  }
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const [yearStart, setYearStart] = useState(
    1900 + Math.floor((year - 1900) / 12) * 12
  );
  const firstMonth = year === 1900 && month === 0;
  const lastMonth =
    year > today.getFullYear() ||
    (year === today.getFullYear() && month >= today.getMonth());
  const previousDisabled =
    mode === 'years'
      ? yearStart === 1900
      : mode === 'months'
        ? year === 1900
        : firstMonth;
  const nextDisabled =
    mode === 'years'
      ? yearStart + 12 > today.getFullYear()
      : mode === 'months'
        ? year === today.getFullYear()
        : lastMonth;
  function move(direction: number) {
    if (mode === 'years') {
      setYearStart(yearStart + direction * 12);
      return;
    }
    if (mode === 'months') {
      const nextYear = Math.max(
        1900,
        Math.min(today.getFullYear(), year + direction)
      );
      setYear(nextYear);
      if (nextYear === today.getFullYear() && month > today.getMonth())
        setMonth(today.getMonth());
      selectDate(undefined);
      return;
    }
    const next = new Date(year, month + direction, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
    selectDate(undefined);
  }
  return (
    <ModalSheet
      animationType="none"
      visible
      onRequestClose={onClose}
      onBackdropPress={onClose}
      backdropStyle={{ backgroundColor: 'rgba(0,0,0,0.48)' }}
      cardStyle={[
        styles.sheet,
        {
          backgroundColor: colors.card,
          paddingBottom: Math.max(insets.bottom, 20),
        },
      ]}
    >
      <ScrollView
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 14 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <View style={styles.heading}>
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.primaryLowOpacity },
            ]}
          >
            <Ionicons
              name="calendar-outline"
              color={colors.primary}
              size={22}
            />
          </View>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            Date of birth
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close date of birth calendar"
            onPress={onClose}
            style={styles.iconButton}
          >
            <Ionicons name="close" size={23} color={colors.textSecondary} />
          </Pressable>
        </View>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Choose the date on your identity records.
        </Text>
        <OxygenBirthDateEditor
          value={selection}
          onDateChange={(parsed) => {
            setSelection(parsed);
            if (parsed) {
              const date = readOxygenBirthDate(parsed, today);
              if (date) {
                setYear(date.getFullYear());
                setMonth(date.getMonth());
                setMode('days');
              }
            }
          }}
        />
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous calendar page"
            accessibilityState={{ disabled: previousDisabled }}
            disabled={previousDisabled}
            onPress={() => move(-1)}
            style={styles.iconButton}
          >
            <Ionicons
              name="chevron-back"
              size={20}
              color={previousDisabled ? colors.border : colors.text}
            />
          </Pressable>
          <View style={styles.selectors}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose birth month"
              onPress={() => setMode(mode === 'months' ? 'days' : 'months')}
              style={[styles.selector, { backgroundColor: colors.muted }]}
            >
              <Text style={[styles.selectorText, { color: colors.text }]}>
                {OXYGEN_BIRTH_MONTHS[month]}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.primary} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose birth year"
              onPress={() => {
                setYearStart(1900 + Math.floor((year - 1900) / 12) * 12);
                setMode(mode === 'years' ? 'days' : 'years');
              }}
              style={[styles.selector, { backgroundColor: colors.muted }]}
            >
              <Text style={[styles.selectorText, { color: colors.text }]}>
                {year}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.primary} />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next calendar page"
            accessibilityState={{ disabled: nextDisabled }}
            disabled={nextDisabled}
            onPress={() => move(1)}
            style={styles.iconButton}
          >
            <Ionicons
              name="chevron-forward"
              size={20}
              color={nextDisabled ? colors.border : colors.text}
            />
          </Pressable>
        </View>
        <OxygenBirthCalendarGrid
          mode={mode}
          year={year}
          month={month}
          yearStart={yearStart}
          selection={selection}
          today={today}
          onDay={selectDate}
          onYear={(selectedYear) => {
            setYear(selectedYear);
            if (
              selectedYear === today.getFullYear() &&
              month > today.getMonth()
            )
              setMonth(today.getMonth());
            setMode('months');
            selectDate(undefined);
          }}
          onMonth={(selectedMonth) => {
            setMonth(selectedMonth);
            setMode('days');
            selectDate(undefined);
          }}
        />
        <OxygenButton
          title="Use this date"
          disabled={!selection || mode !== 'days'}
          onPress={() => {
            if (selection) onSelect(selection);
          }}
        />
      </ScrollView>
    </ModalSheet>
  );
}
