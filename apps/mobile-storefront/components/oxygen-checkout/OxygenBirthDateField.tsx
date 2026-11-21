import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import { OxygenBirthCalendarSheet } from './OxygenBirthCalendarSheet';
import { useOxygenColors } from './OxygenFormPrimitives';

export function OxygenBirthDateField({
  value,
  onChange,
  disabled,
  error,
}: {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  const colors = useOxygenColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>Date of birth</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose date of birth"
        accessibilityState={{ expanded: open, disabled }}
        onPress={() => setOpen(true)}
        disabled={disabled}
        style={[
          styles.field,
          {
            backgroundColor: disabled ? colors.muted : colors.card,
            borderColor: error ? colors.primary : colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.text,
            { color: value ? colors.text : colors.placeholder },
          ]}
        >
          {value ? formatDateTimeDisplay(value, 'date') : 'DD/MM/YYYY'}
        </Text>
      </Pressable>
      <View style={[styles.icon, { pointerEvents: 'none' }]}>
        <Ionicons name="calendar-outline" size={22} color={colors.primary} />
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.error, fontSize: 13 }}
        >
          {error}
        </Text>
      ) : null}
      {open && !disabled ? (
        <OxygenBirthCalendarSheet
          key={value ?? 'empty'}
          value={value}
          onClose={() => setOpen(false)}
          onSelect={(selected) => {
            onChange(selected);
            setOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 18, gap: 6 },
  label: { fontSize: 14, fontWeight: '600' },
  field: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 54,
    justifyContent: 'center',
  },
  text: { fontSize: 16 },
  icon: { position: 'absolute', right: 16, top: 40 },
});
