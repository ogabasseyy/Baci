import { Pressable, StyleSheet, Text } from 'react-native';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';

export interface ChoiceSheetOption<TValue extends string> {
  label: string;
  value: TValue;
}

interface ChoiceSheetModalProps<TValue extends string> {
  colors: ThemeColors;
  message?: string;
  onClose: () => void;
  onSelect: (value: TValue) => void;
  options: ChoiceSheetOption<TValue>[];
  title: string;
  visible: boolean;
}

/**
 * A pick-one list in a bottom sheet. Unlike `showChoiceSheet`, which falls
 * back to a system alert on Android (three buttons at most, the rest are
 * silently dropped), every option is always shown.
 */
export function ChoiceSheetModal<TValue extends string>({
  colors,
  message,
  onClose,
  onSelect,
  options,
  title,
  visible,
}: ChoiceSheetModalProps<TValue>) {
  return (
    <AppSheetModal
      accessibilityLabel={title}
      onClose={onClose}
      visible={visible}
    >
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {message ? (
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          {message}
        </Text>
      ) : null}
      {options.map((option) => (
        <Pressable
          accessibilityLabel={option.label}
          accessibilityRole="button"
          key={option.value}
          onPress={() => onSelect(option.value)}
          style={[
            styles.option,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.optionText, { color: colors.text }]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityLabel="Cancel"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.cancel}
      >
        <Text style={{ color: colors.textSecondary }}>Cancel</Text>
      </Pressable>
    </AppSheetModal>
  );
}

const styles = StyleSheet.create({
  cancel: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.xs,
    minHeight: SPACING.touchTarget,
  },
  message: { fontSize: TYPOGRAPHY.size.md, marginTop: SPACING.xs },
  option: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: SPACING.sm,
    minHeight: SPACING.touchTarget,
    paddingHorizontal: SPACING.lg,
  },
  optionText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.md,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.lg,
  },
});
