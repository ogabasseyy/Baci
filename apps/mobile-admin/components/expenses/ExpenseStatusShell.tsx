import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { styles } from './expense-detail.styles';
import type { ExpenseStatusShellProps } from './types';

export function ExpenseStatusShell({
  status,
  colors,
  errorMessage,
  onRetry,
}: ExpenseStatusShellProps) {
  if (status === 'error') {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          styles.errorContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <Ionicons
          name="warning-outline"
          size={32}
          color={colors.textSecondary}
        />
        <Text style={{ color: colors.textSecondary }}>
          Could not load expense.
        </Text>
        <Text style={{ color: colors.textSecondary }}>
          {errorMessage ?? 'Please try again later.'}
        </Text>
        {onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={onRetry}
          >
            <Text style={{ color: colors.primary }}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        styles.center,
        { backgroundColor: colors.background },
      ]}
    >
      <Text style={{ color: colors.textSecondary }}>
        {status === 'loading'
          ? 'Loading expense details...'
          : status === 'denied'
            ? (errorMessage ?? 'You do not have permission to view expenses')
            : 'Expense not found.'}
      </Text>
    </View>
  );
}
