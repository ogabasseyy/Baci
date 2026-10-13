import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';
import SafeImage from '@/components/ui/SafeImage';
import type { ExpenseReceiptChange } from '@/hooks/useExpenseFormState';
import { useTheme } from '@/hooks/useTheme';

interface ExpenseReceiptFieldProps {
  disabled?: boolean;
  existingReceiptUri: string | null;
  hasExistingReceipt?: boolean;
  onRemoveReceipt?: () => void;
  onRestoreReceipt?: () => void;
  onSelectReceipt: () => void;
  receiptChange: ExpenseReceiptChange;
  receiptError?: Error | null;
  receiptLoading?: boolean;
}

export function ExpenseReceiptField({
  disabled = false,
  existingReceiptUri,
  hasExistingReceipt = existingReceiptUri !== null,
  onRemoveReceipt,
  onRestoreReceipt,
  onSelectReceipt,
  receiptChange,
  receiptError = null,
  receiptLoading = false,
}: ExpenseReceiptFieldProps) {
  const { colors } = useTheme();
  const localReceiptUri =
    receiptChange.kind === 'replace' ? receiptChange.localUri : null;
  const receiptUri =
    receiptChange.kind === 'remove'
      ? null
      : (localReceiptUri ?? existingReceiptUri);
  const hasLocalReceipt = localReceiptUri !== null;

  return (
    <View style={expenseFormStyles.section}>
      <Text style={[expenseFormStyles.label, { color: colors.textSecondary }]}>
        Receipt (Optional)
      </Text>

      {hasExistingReceipt && receiptLoading ? (
        <Text style={{ color: colors.textSecondary }}>Loading receipt…</Text>
      ) : null}
      {hasExistingReceipt && receiptError ? (
        <Text style={{ color: colors.error }}>
          Could not load the existing receipt. You can replace it.
        </Text>
      ) : null}

      {receiptChange.kind === 'remove' ? (
        <View
          style={[
            expenseFormStyles.receiptRemovalNotice,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              expenseFormStyles.receiptStatusText,
              { color: colors.text },
            ]}
          >
            Receipt will be removed when you save.
          </Text>
          <View style={expenseFormStyles.receiptActions}>
            {hasExistingReceipt && onRestoreReceipt ? (
              <Pressable
                accessibilityLabel="Restore expense receipt"
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={onRestoreReceipt}
                style={[
                  expenseFormStyles.receiptActionButton,
                  { borderColor: colors.border, borderWidth: 1 },
                  disabled && expenseFormStyles.disabled,
                ]}
              >
                <Ionicons
                  color={colors.text}
                  name="refresh-outline"
                  size={18}
                />
                <Text
                  style={[
                    expenseFormStyles.receiptActionText,
                    { color: colors.text },
                  ]}
                >
                  Restore
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="Add expense receipt"
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={onSelectReceipt}
              style={[
                expenseFormStyles.receiptActionButton,
                { backgroundColor: colors.primary },
                disabled && expenseFormStyles.disabled,
              ]}
            >
              <Text
                style={[
                  expenseFormStyles.receiptActionText,
                  { color: colors.textOnPrimary },
                ]}
              >
                Add receipt
              </Text>
            </Pressable>
          </View>
        </View>
      ) : receiptUri && (!receiptError || hasLocalReceipt) ? (
        <>
          <View
            style={[
              expenseFormStyles.imageUpload,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <SafeImage
              accessibilityLabel={
                hasLocalReceipt
                  ? 'New receipt preview'
                  : 'Existing receipt preview'
              }
              contentFit="cover"
              source={{ uri: receiptUri }}
              style={expenseFormStyles.receiptPreview}
              transition={200}
            />
          </View>
          <Text
            style={[
              expenseFormStyles.receiptStatusText,
              { color: colors.textSecondary },
            ]}
          >
            {hasLocalReceipt
              ? 'New receipt selected'
              : 'Existing receipt attached'}
          </Text>
          <View style={expenseFormStyles.receiptActions}>
            <Pressable
              accessibilityLabel="Replace expense receipt"
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={onSelectReceipt}
              style={[
                expenseFormStyles.receiptActionButton,
                { backgroundColor: colors.primary },
                disabled && expenseFormStyles.disabled,
              ]}
            >
              <Ionicons color={colors.textOnPrimary} name="camera" size={18} />
              <Text
                style={[
                  expenseFormStyles.receiptActionText,
                  { color: colors.textOnPrimary },
                ]}
              >
                Replace
              </Text>
            </Pressable>
            {onRemoveReceipt ? (
              <Pressable
                accessibilityLabel="Remove expense receipt"
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={onRemoveReceipt}
                style={[
                  expenseFormStyles.receiptActionButton,
                  { borderColor: colors.border, borderWidth: 1 },
                  disabled && expenseFormStyles.disabled,
                ]}
              >
                <Ionicons color={colors.text} name="trash-outline" size={18} />
                <Text
                  style={[
                    expenseFormStyles.receiptActionText,
                    { color: colors.text },
                  ]}
                >
                  Remove
                </Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : hasExistingReceipt &&
        onRemoveReceipt &&
        !(receiptUri && (!receiptError || hasLocalReceipt)) ? (
        <View style={expenseFormStyles.receiptActions}>
          <Pressable
            accessibilityLabel="Add expense receipt"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onSelectReceipt}
            style={[
              expenseFormStyles.receiptActionButton,
              { backgroundColor: colors.primary },
              disabled && expenseFormStyles.disabled,
            ]}
          >
            <Text
              style={[
                expenseFormStyles.receiptActionText,
                { color: colors.textOnPrimary },
              ]}
            >
              Add receipt
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Remove expense receipt"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onRemoveReceipt}
            style={[
              expenseFormStyles.receiptActionButton,
              { borderColor: colors.border, borderWidth: 1 },
              disabled && expenseFormStyles.disabled,
            ]}
          >
            <Ionicons color={colors.text} name="trash-outline" size={18} />
            <Text
              style={[
                expenseFormStyles.receiptActionText,
                { color: colors.text },
              ]}
            >
              Remove
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityLabel="Add expense receipt"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onSelectReceipt}
          style={[
            expenseFormStyles.imageUpload,
            { backgroundColor: colors.card, borderColor: colors.border },
            expenseFormStyles.imageUploadEmpty,
            disabled && expenseFormStyles.disabled,
          ]}
        >
          <View style={expenseFormStyles.uploadPlaceholder}>
            <Ionicons color={colors.primary} name="camera-outline" size={32} />
            <Text
              style={[expenseFormStyles.uploadText, { color: colors.primary }]}
            >
              Add Receipt Photo
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
