import { View } from 'react-native';
import { ExpenseStatusShell } from '@/components/expenses/ExpenseStatusShell';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';
import type { ThemeColors } from '@/constants/theme';

export function ExpenseDependencyError({
  colors,
  message,
  onRetry,
}: {
  colors: ThemeColors;
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={expenseFormStyles.section}>
      <ExpenseStatusShell
        colors={colors}
        errorMessage={message}
        onRetry={onRetry}
        status="error"
      />
    </View>
  );
}
