import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import { Pressable } from 'react-native';
import { SPACING, type ThemeColors } from '@/constants/theme';

export function ExpenseEditHeader({
  colors,
  onClose,
}: {
  colors: ThemeColors;
  onClose: () => void;
}) {
  return (
    <Stack.Screen
      options={{
        headerLeft: () => (
          <Pressable
            accessibilityLabel="Close edit expense screen"
            accessibilityRole="button"
            onPress={onClose}
            style={{ padding: SPACING.sm }}
          >
            <Ionicons color={colors.text} name="close" size={24} />
          </Pressable>
        ),
        title: 'Edit Expense',
      }}
    />
  );
}
