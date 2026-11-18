import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';

export function OxygenFormSelect({
  label,
  value,
  options,
  placeholder,
  disabled,
  error,
  onChange,
}: {
  label: string;
  value?: string;
  options: readonly { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const colors = useOxygenColors();
  const [open, setOpen] = useState(false);
  const expanded = open && !disabled;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <View
        style={[
          styles.control,
          {
            backgroundColor: colors.card,
            borderColor: expanded || error ? colors.primary : colors.border,
          },
        ]}
      >
        <Pressable
          accessibilityRole="combobox"
          accessibilityLabel={label}
          accessibilityState={{ expanded, disabled }}
          disabled={disabled}
          onPress={() => setOpen(!open)}
          style={styles.trigger}
        >
          <Text
            style={[
              styles.value,
              { color: value ? colors.text : colors.placeholder },
            ]}
          >
            {options.find((option) => option.value === value)?.label ??
              placeholder}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
        {expanded ? (
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={[styles.list, { borderTopColor: colors.border }]}
          >
            {options.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: value === option.value }}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={[
                  styles.option,
                  {
                    backgroundColor:
                      value === option.value
                        ? colors.primaryLowOpacity
                        : colors.card,
                  },
                ]}
              >
                <Text style={[styles.value, { color: colors.text }]}>
                  {option.label}
                </Text>
                {value === option.value ? (
                  <Ionicons name="checkmark" size={18} color={colors.primary} />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.error, fontSize: 13 }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  field: { gap: 8, marginBottom: 18 },
  label: { fontSize: 14, fontWeight: '600' },
  control: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  trigger: {
    minHeight: 52,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  value: { flex: 1, fontSize: 16 },
  list: { maxHeight: 240, borderTopWidth: 1 },
  option: {
    minHeight: 48,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
