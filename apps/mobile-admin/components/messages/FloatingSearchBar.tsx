import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';

/**
 * Room the list leaves at its bottom so the last rows can scroll clear of the
 * floating pill (pill height plus its spacing).
 */
export const FLOATING_SEARCH_CLEARANCE = 80;

interface FloatingSearchBarProps {
  colors: ThemeColors;
  onChangeText: (text: string) => void;
  value: string;
}

/**
 * Rounded search pill that floats over the bottom of the list, where a thumb
 * reaches. The field itself is solid, so what is typed is easy to read; there is
 * no bar or strip behind it, so the chats show around it and scroll underneath.
 * Searches names, contacts and message text.
 */
export function FloatingSearchBar({
  colors,
  onChangeText,
  value,
}: FloatingSearchBarProps) {
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.pill,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Ionicons color={colors.textMuted} name="search" size={20} />
        <TextInput
          accessibilityLabel="Search chats"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={100}
          onChangeText={onChangeText}
          placeholder="Search names or messages"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          style={[styles.input, { color: colors.text }]}
          value={value}
        />
        {value.length > 0 ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={SPACING.sm}
            onPress={() => onChangeText('')}
          >
            <Ionicons color={colors.textMuted} name="close-circle" size={20} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    fontSize: TYPOGRAPHY.size.md,
    minHeight: SPACING.touchTarget,
    paddingVertical: 0,
  },
  pill: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    borderWidth: StyleSheet.hairlineWidth * 2,
    elevation: 6,
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  wrap: {
    paddingBottom: SPACING.xs,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
});
