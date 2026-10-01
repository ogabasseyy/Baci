import type { ExpenseBranchOption } from '@/components/expenses/ExpenseBranchSelector';
import { ExpenseBranchSelector } from '@/components/expenses/ExpenseBranchSelector';
import { ExpenseCoreFields } from '@/components/expenses/ExpenseCoreFields';
import { ExpenseGroupSelector } from '@/components/expenses/ExpenseGroupSelector';
import { ExpenseMetadataFields } from '@/components/expenses/ExpenseMetadataFields';
import { ExpenseReceiptField } from '@/components/expenses/ExpenseReceiptField';
import type { ExpenseCategory } from '@/components/expenses/expense-categories';
import type { ExpenseReceiptChange } from '@/hooks/useExpenseFormState';
import { expenseDateCodec } from '@/lib/expense-date';
import type { ExpenseGroup } from '@/schemas/expense-group';

interface ExpenseFormFieldsProps {
  amount: string;
  description: string;
  onAmountChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onOpenCategorySheet: () => void;
  onReceiptPress: () => void;
  receiptUri: string | null;
  receiptError?: Error | null;
  receiptLoading?: boolean;
  selectedCategory: ExpenseCategory | string | null;
  activeGroups?: ExpenseGroup[];
  branches?: ExpenseBranchOption[];
  canEditGroups?: boolean;
  date?: string;
  disabled?: boolean;
  existingReceiptUri?: string | null;
  hasExistingReceipt?: boolean;
  onBranchChange?: (branchId: string) => void;
  onDateChange?: (value: string) => void;
  onGroupChange?: (groupId: string | null) => void;
  onManageGroups?: () => void;
  onPaymentMethodChange?: (value: string) => void;
  onReceiptRemove?: () => void;
  onReceiptRestore?: () => void;
  onReferenceChange?: (value: string) => void;
  onVendorNameChange?: (value: string) => void;
  paymentMethod?: string;
  receiptChange?: ExpenseReceiptChange;
  reference?: string;
  selectedBranchId?: string | null;
  selectedGroupId?: string | null;
  vendorName?: string;
}

export function ExpenseFormFields({
  activeGroups,
  amount,
  branches,
  canEditGroups = false,
  date,
  description,
  disabled = false,
  existingReceiptUri = null,
  hasExistingReceipt,
  onAmountChange,
  onBranchChange,
  onDateChange,
  onDescriptionChange,
  onGroupChange,
  onManageGroups,
  onOpenCategorySheet,
  onPaymentMethodChange,
  onReceiptPress,
  onReceiptRemove,
  onReceiptRestore,
  onReferenceChange,
  onVendorNameChange,
  paymentMethod = '',
  receiptChange,
  receiptUri,
  receiptError,
  receiptLoading,
  reference = '',
  selectedBranchId,
  selectedCategory,
  selectedGroupId,
  vendorName = '',
}: ExpenseFormFieldsProps) {
  const resolvedDate = date ?? expenseDateCodec.toDateOnly(new Date());
  const resolvedReceiptChange: ExpenseReceiptChange =
    receiptChange ??
    (receiptUri
      ? { kind: 'replace', localUri: receiptUri }
      : { kind: 'unchanged' });
  return (
    <>
      {branches && onBranchChange && selectedBranchId !== undefined ? (
        <ExpenseBranchSelector
          branches={branches}
          disabled={disabled}
          onSelect={onBranchChange}
          selectedBranchId={selectedBranchId ?? null}
        />
      ) : null}
      <ExpenseCoreFields
        amount={amount}
        date={resolvedDate}
        description={description}
        disabled={disabled}
        onAmountChange={onAmountChange}
        onDateChange={onDateChange}
        onDescriptionChange={onDescriptionChange}
        onOpenCategorySheet={onOpenCategorySheet}
        selectedCategory={selectedCategory}
      />
      {onPaymentMethodChange && onReferenceChange && onVendorNameChange ? (
        <ExpenseMetadataFields
          disabled={disabled}
          onPaymentMethodChange={onPaymentMethodChange}
          onReferenceChange={onReferenceChange}
          onVendorNameChange={onVendorNameChange}
          paymentMethod={paymentMethod}
          reference={reference}
          vendorName={vendorName}
        />
      ) : null}
      {activeGroups &&
      onGroupChange &&
      onManageGroups &&
      selectedGroupId !== undefined ? (
        <ExpenseGroupSelector
          activeGroups={activeGroups}
          canEdit={canEditGroups}
          disabled={disabled}
          onManage={onManageGroups}
          onSelect={onGroupChange}
          selectedGroupId={selectedGroupId ?? null}
        />
      ) : null}
      <ExpenseReceiptField
        disabled={disabled}
        existingReceiptUri={existingReceiptUri}
        hasExistingReceipt={hasExistingReceipt}
        onRemoveReceipt={onReceiptRemove}
        onRestoreReceipt={onReceiptRestore}
        onSelectReceipt={onReceiptPress}
        receiptChange={resolvedReceiptChange}
        receiptError={receiptError}
        receiptLoading={receiptLoading}
      />
    </>
  );
}
