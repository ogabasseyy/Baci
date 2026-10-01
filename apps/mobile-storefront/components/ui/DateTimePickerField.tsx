import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { RADIUS, SPACING, withAlpha } from '@/constants/Colors';

type DateTimePickerFieldMode = 'date' | 'time';

// The savings flow design defaults preferred debit time to 06:20 AM.
const DEFAULT_TIME_HOUR = 6;
const DEFAULT_TIME_MINUTE = 20;

type DateTimePickerFieldProps = {
  accessibilityLabel: string;
  fieldStyle?: StyleProp<ViewStyle>;
  fallbackDisplay: string;
  label: string;
  labelStyle?: StyleProp<TextStyle>;
  mode: DateTimePickerFieldMode;
  onChangeText: (value: string) => void;
  textStyle?: StyleProp<TextStyle>;
  value: string;
  wrapperStyle?: StyleProp<ViewStyle>;
};

function parseDateValue(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  return date;
}

/**
 * Parse an `HH:MM` time string for the native picker. Non-numeric or
 * out-of-range components fall back to DEFAULT_TIME_HOUR and
 * DEFAULT_TIME_MINUTE, and the returned Date always has seconds and
 * milliseconds zeroed.
 */
function parseTimeValue(value: string) {
  const [rawHours, rawMinutes] = value.split(':');
  const parsedHours = Number(rawHours);
  const parsedMinutes = Number(rawMinutes);
  const hours =
    Number.isFinite(parsedHours) && parsedHours >= 0 && parsedHours <= 23
      ? parsedHours
      : DEFAULT_TIME_HOUR;
  const minutes =
    Number.isFinite(parsedMinutes) && parsedMinutes >= 0 && parsedMinutes <= 59
      ? parsedMinutes
      : DEFAULT_TIME_MINUTE;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function formatDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeValue(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parsePickerValue(value: string, mode: DateTimePickerFieldMode) {
  return mode === 'date' ? parseDateValue(value) : parseTimeValue(value);
}

function formatPickerValue(date: Date, mode: DateTimePickerFieldMode) {
  return mode === 'date' ? formatDateValue(date) : formatTimeValue(date);
}

export function DateTimePickerField({
  accessibilityLabel,
  fallbackDisplay,
  fieldStyle,
  label,
  labelStyle,
  mode,
  onChangeText,
  textStyle,
  value,
  wrapperStyle,
}: DateTimePickerFieldProps) {
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [draftPickerValue, setDraftPickerValue] = useState<Date | null>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const pickerValue =
    parsePickerValue(value, mode) ??
    // The native picker requires a Date object; use today only at the UI
    // boundary when an empty or malformed date is actively opened.
    new Date();

  const handlePickerChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date
  ) => {
    if (event.type === 'dismissed') {
      setDraftPickerValue(null);
      setIsPickerVisible(false);
      return;
    }

    if (selectedDate) {
      setDraftPickerValue(selectedDate);
      onChangeText(formatPickerValue(selectedDate, mode));
    }
    // iOS spinner pickers emit `set` events while the user scrolls. Keep the
    // picker mounted so the user can finish scrolling and submit the selected
    // value with the form's Continue button. Android closes its native dialog
    // after a selection.
    if (Platform.OS !== 'ios') {
      setIsPickerVisible(false);
    }
  };

  const handleOpenPicker = () => {
    setDraftPickerValue(pickerValue);
    setIsPickerVisible(true);
  };

  const handleDone = () => {
    const valueToCommit = draftPickerValue ?? pickerValue;
    const formattedValue = formatPickerValue(valueToCommit, mode);
    if (formattedValue !== value) onChangeText(formattedValue);
    setDraftPickerValue(null);
    setIsPickerVisible(false);
  };

  return (
    <View style={wrapperStyle}>
      <Text style={labelStyle}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={handleOpenPicker}
        style={fieldStyle}
      >
        <Text style={textStyle}>{value || fallbackDisplay}</Text>
      </Pressable>
      {isPickerVisible && Platform.OS === 'ios' ? (
        <Modal
          accessibilityViewIsModal
          animationType="slide"
          onRequestClose={() => setIsPickerVisible(false)}
          transparent
          visible
        >
          <View
            style={[
              styles.iosPickerOverlay,
              { backgroundColor: withAlpha(colors.black, 0.5) },
            ]}
          >
            <View
              style={[styles.iosPickerSheet, { backgroundColor: colors.card }]}
            >
              <DateTimePicker
                accessibilityLabel={accessibilityLabel}
                display="spinner"
                mode={mode}
                themeVariant={colorScheme === 'dark' ? 'dark' : 'light'}
                value={pickerValue}
                onChange={handlePickerChange}
              />
              <Pressable
                accessibilityLabel={`Done selecting ${label}`}
                accessibilityRole="button"
                onPress={handleDone}
                style={styles.iosPickerDone}
              >
                <Text
                  style={[
                    styles.iosPickerDoneText,
                    { color: colors.primary },
                    textStyle,
                  ]}
                >
                  Done
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : isPickerVisible ? (
        <View>
          <DateTimePicker
            accessibilityLabel={accessibilityLabel}
            display="default"
            mode={mode}
            themeVariant={colorScheme === 'dark' ? 'dark' : 'light'}
            value={pickerValue}
            onChange={handlePickerChange}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  iosPickerDone: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: 44,
  },
  iosPickerDoneText: {
    fontSize: 16,
    fontWeight: '700',
  },
  iosPickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    opacity: 0.98,
  },
  iosPickerSheet: {
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    padding: SPACING.md,
    width: '100%',
  },
});
