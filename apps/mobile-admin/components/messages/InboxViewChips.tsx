import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import { INBOX_VIEWS, type InboxView } from '@/schemas/merchant-inbox';

interface InboxViewChipsProps {
  colors: ThemeColors;
  onChange: (view: InboxView) => void;
  value: InboxView;
}

/** One row of views, so a busy inbox is a tap away from what needs doing. */
export function InboxViewChips({
  colors,
  onChange,
  value,
}: InboxViewChipsProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.row}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {INBOX_VIEWS.map((view) => {
        const selected = view.value === value;
        return (
          <Pressable
            accessibilityLabel={view.label}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={view.value}
            onPress={() => onChange(view.value)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.primary : colors.card,
                borderColor: selected ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                { color: selected ? colors.textOnPrimary : colors.text },
              ]}
            >
              {view.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: SPACING.md + 2,
  },
  label: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.md,
  },
  row: {
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
});
