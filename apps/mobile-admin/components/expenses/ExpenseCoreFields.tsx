import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ExpenseCategory } from '@/components/expenses/expense-categories';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';
import { AppDatePickerField } from '@/components/ui/AppDatePickerField';
import { useCurrency } from '@/hooks/useCurrency';
import { useTheme } from '@/hooks/useTheme';
import { expenseDateCodec } from '@/lib/expense-date';

const CATEGORY_PLACEHOLDER = 'Select a category';

interface ExpenseCoreFieldsProps {
  amount: string;
  date: string;
  description: string;
  disabled?: boolean;
  onAmountChange: (value: string) => void;
  onDateChange?: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onOpenCategorySheet: () => void;
  selectedCategory: ExpenseCategory | string | null;
}

function formatAmount(amount: string): string {
  if (!amount) return '';

  const [whole, decimal] = amount.split('.');
  const formattedWhole = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return decimal === undefined
    ? formattedWhole
    : `${formattedWhole}.${decimal}`;
}

function normalizeAmount(value: string): string | null {
  const withoutSeparators = value.replace(/[,\s₦$£€]/g, '');

  if (withoutSeparators === '') return '';
  if (!/^\d*\.?\d*$/.test(withoutSeparators)) return null;

  return withoutSeparators;
}

export function ExpenseCoreFields({
  amount,
  date,
  description,
  disabled = false,
  onAmountChange,
  onDateChange,
  onDescriptionChange,
  onOpenCategorySheet,
  selectedCategory,
}: ExpenseCoreFieldsProps) {
  const { colors } = useTheme();
  const { symbol } = useCurrency();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const selectedDate = expenseDateCodec.fromDateOnly(date) ?? new Date();
  const isDateDisabled = disabled || !onDateChange;
  const selectedCategoryLabel =
    typeof selectedCategory === 'string' && selectedCategory.trim().length > 0
      ? selectedCategory
      : CATEGORY_PLACEHOLDER;
  const hasSelectedCategory = selectedCategoryLabel !== CATEGORY_PLACEHOLDER;

  return (
    <>
      <View style={expenseFormStyles.section}>
        <Text
          style={[expenseFormStyles.label, { color: colors.textSecondary }]}
        >
          Amount <Text style={{ color: colors.error }}>*</Text>
        </Text>
        <View
          style={[
            expenseFormStyles.amountContainer,
            { borderColor: colors.border },
          ]}
        >
          <Text
            style={[expenseFormStyles.currencyPrefix, { color: colors.text }]}
          >
            {symbol}
          </Text>
          <TextInput
            accessibilityLabel="Expense amount"
            editable={!disabled}
            keyboardType="decimal-pad"
            onChangeText={(value) => {
              const normalized = normalizeAmount(value);
              if (normalized !== null) onAmountChange(normalized);
            }}
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            style={[expenseFormStyles.amountInput, { color: colors.text }]}
            value={formatAmount(amount)}
          />
        </View>
      </View>

      <View style={expenseFormStyles.section}>
        <Text
          style={[expenseFormStyles.label, { color: colors.textSecondary }]}
        >
          Date <Text style={{ color: colors.error }}>*</Text>
        </Text>
        <Pressable
          accessibilityHint="Opens a date picker for the expense date"
          accessibilityLabel="Select expense date"
          accessibilityRole="button"
          accessibilityState={{
            disabled: isDateDisabled,
            expanded: showDatePicker,
          }}
          disabled={isDateDisabled}
          onPress={() => setShowDatePicker(true)}
          style={[
            expenseFormStyles.selector,
            { backgroundColor: colors.card, borderColor: colors.border },
            isDateDisabled && expenseFormStyles.disabled,
          ]}
        >
          <Text style={[expenseFormStyles.optionText, { color: colors.text }]}>
            {selectedDate.toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </Text>
          <Ionicons
            color={colors.textMuted}
            name="calendar-outline"
            size={20}
          />
        </Pressable>

        {showDatePicker ? (
          <AppDatePickerField
            cancelTextColor={colors.textMuted}
            confirmTextColor={colors.primary}
            onClose={() => setShowDatePicker(false)}
            onConfirm={(nextDate) => {
              onDateChange?.(expenseDateCodec.toDateOnly(nextDate));
              setShowDatePicker(false);
            }}
            value={selectedDate}
          />
        ) : null}
      </View>

      <View style={expenseFormStyles.section}>
        <Text
          style={[expenseFormStyles.label, { color: colors.textSecondary }]}
        >
          Category <Text style={{ color: colors.error }}>*</Text>
        </Text>
        <Pressable
          accessibilityLabel="Select expense category"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onOpenCategorySheet}
          style={[
            expenseFormStyles.selector,
            { backgroundColor: colors.card, borderColor: colors.border },
            disabled && expenseFormStyles.disabled,
          ]}
        >
          <Text
            style={[
              expenseFormStyles.optionText,
              {
                color: hasSelectedCategory ? colors.text : colors.textSecondary,
              },
            ]}
          >
            {selectedCategoryLabel}
          </Text>
          <Ionicons color={colors.textMuted} name="chevron-down" size={20} />
        </Pressable>
      </View>

      <View style={expenseFormStyles.section}>
        <Text
          style={[expenseFormStyles.label, { color: colors.textSecondary }]}
        >
          Description (Optional)
        </Text>
        <TextInput
          accessibilityLabel="Expense description"
          editable={!disabled}
          maxLength={500}
          multiline
          onChangeText={onDescriptionChange}
          placeholder="What was this for?"
          placeholderTextColor={colors.textMuted}
          style={[
            expenseFormStyles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.text,
            },
            disabled && expenseFormStyles.disabled,
          ]}
          value={description}
        />
      </View>
    </>
  );
}
