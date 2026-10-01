import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { expenseFormStyles } from './expense-form.styles';

export function AddExpenseFooter({
  busy,
  colors,
  disabled,
  onSave,
}: {
  busy: boolean;
  colors: {
    card: string;
    border: string;
    primary: string;
    textOnPrimary: string;
  };
  disabled: boolean;
  onSave: () => void;
}) {
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
        disabled={disabled}
        onPress={onSave}
        style={[
          expenseFormStyles.saveButton,
          { backgroundColor: colors.primary, opacity: disabled ? 0.7 : 1 },
        ]}
      >
        {busy ? (
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
