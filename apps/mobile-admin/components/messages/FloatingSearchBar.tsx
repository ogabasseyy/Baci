import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';

interface FloatingSearchBarProps {
  colors: ThemeColors;
  onChangeText: (text: string) => void;
  value: string;
}

/**
 * Rounded search pill that sits at the bottom of the screen, where a thumb
 * reaches. Searches names, contacts and message text.
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
    borderWidth: 1,
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
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
});
