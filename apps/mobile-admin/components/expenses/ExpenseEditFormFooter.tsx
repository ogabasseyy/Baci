import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';

interface ExpenseEditFormFooterProps {
  colors: {
    border: string;
    card: string;
    primary: string;
    textOnPrimary: string;
  };
  disabled: boolean;
  isDirty: boolean;
  isPending: boolean;
  onSave: () => void;
}

export function ExpenseEditFormFooter({
  colors,
  disabled,
  isDirty,
  isPending,
  onSave,
}: ExpenseEditFormFooterProps) {
  return (
    <View
      style={[
        expenseFormStyles.footer,
        { backgroundColor: colors.card, borderTopColor: colors.border },
      ]}
    >
      <Pressable
        accessibilityLabel="Save expense"
        accessibilityRole="button"
        disabled={!isDirty || disabled}
        onPress={onSave}
        style={[
          expenseFormStyles.saveButton,
          {
            backgroundColor: colors.primary,
            opacity: !isDirty || disabled ? 0.7 : 1,
          },
        ]}
      >
        {isPending ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text
            style={[
              expenseFormStyles.saveButtonText,
              { color: colors.textOnPrimary },
            ]}
          >
            Save Expense
          </Text>
        )}
      </Pressable>
    </View>
  );
}
