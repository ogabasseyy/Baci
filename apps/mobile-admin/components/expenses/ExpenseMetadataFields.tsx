import { Text, TextInput, View } from 'react-native';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';
import { useTheme } from '@/hooks/useTheme';

interface ExpenseMetadataFieldsProps {
  disabled?: boolean;
  onPaymentMethodChange: (value: string) => void;
  onReferenceChange: (value: string) => void;
  onVendorNameChange: (value: string) => void;
  paymentMethod: string;
  reference: string;
  vendorName: string;
}

interface MetadataInputProps {
  accessibilityLabel: string;
  disabled: boolean;
  label: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}

function MetadataInput({
  accessibilityLabel,
  disabled,
  label,
  onChangeText,
  placeholder,
  value,
}: MetadataInputProps) {
  const { colors } = useTheme();

  return (
    <View style={expenseFormStyles.section}>
      <Text style={[expenseFormStyles.label, { color: colors.textSecondary }]}>
        {label} (Optional)
      </Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        editable={!disabled}
        maxLength={120}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[
          expenseFormStyles.metadataInput,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            color: colors.text,
          },
          disabled && expenseFormStyles.disabled,
        ]}
        value={value}
      />
    </View>
  );
}

export function ExpenseMetadataFields({
  disabled = false,
  onPaymentMethodChange,
  onReferenceChange,
  onVendorNameChange,
  paymentMethod,
  reference,
  vendorName,
}: ExpenseMetadataFieldsProps) {
  return (
    <>
      <MetadataInput
        accessibilityLabel="Expense vendor or payee"
        disabled={disabled}
        label="Vendor or payee"
        onChangeText={onVendorNameChange}
        placeholder="e.g. ISP Ltd"
        value={vendorName}
      />
      <MetadataInput
        accessibilityLabel="Expense payment method"
        disabled={disabled}
        label="Payment method"
        onChangeText={onPaymentMethodChange}
        placeholder="e.g. Transfer"
        value={paymentMethod}
      />
      <MetadataInput
        accessibilityLabel="Expense reference"
        disabled={disabled}
        label="Reference"
        onChangeText={onReferenceChange}
        placeholder="e.g. INV-101"
        value={reference}
      />
    </>
  );
}
