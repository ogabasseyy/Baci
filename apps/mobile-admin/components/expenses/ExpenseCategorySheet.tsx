import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from '@/components/expenses/expense-categories';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';
import { AppSheetModal } from '@/components/ui/AppSheetModal';
import { useTheme } from '@/hooks/useTheme';

interface ExpenseCategorySheetProps {
  onClose: () => void;
  onSelect: (category: ExpenseCategory) => void;
  selectedCategory: ExpenseCategory | null;
  visible: boolean;
}

export function ExpenseCategorySheet({
  onClose,
  onSelect,
  selectedCategory,
  visible,
}: ExpenseCategorySheetProps) {
  const { colors } = useTheme();

  return (
    <AppSheetModal
      accessibilityLabel="Expense category sheet"
      onClose={onClose}
      visible={visible}
    >
      <View
        style={[
          expenseFormStyles.sheetHeader,
          { borderBottomColor: colors.border },
        ]}
      >
        <Text style={[expenseFormStyles.sheetTitle, { color: colors.text }]}>
          Select Category
        </Text>
        <Pressable
          accessibilityLabel="Close expense category sheet"
          accessibilityRole="button"
          onPress={onClose}
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        {EXPENSE_CATEGORIES.map((category) => (
          <Pressable
            accessibilityLabel={`Select ${category} expense category`}
            accessibilityRole="button"
            key={category}
            onPress={() => {
              onSelect(category);
              onClose();
            }}
            style={[
              expenseFormStyles.categoryOption,
              { borderBottomColor: colors.border },
              selectedCategory === category && {
                backgroundColor: colors.primaryLight,
              },
            ]}
          >
            <Text
              style={[
                expenseFormStyles.optionText,
                {
                  color:
                    selectedCategory === category
                      ? colors.primary
                      : colors.text,
                },
              ]}
            >
              {category}
            </Text>
            {selectedCategory === category ? (
              <Ionicons name="checkmark" size={20} color={colors.primary} />
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </AppSheetModal>
  );
}
