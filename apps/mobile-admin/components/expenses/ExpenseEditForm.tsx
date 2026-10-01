import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { ExpenseCategorySheet } from '@/components/expenses/ExpenseCategorySheet';
import { ExpenseDependencyError } from '@/components/expenses/ExpenseDependencyError';
import { ExpenseEditFormFooter } from '@/components/expenses/ExpenseEditFormFooter';
import { ExpenseEditHeader } from '@/components/expenses/ExpenseEditHeader';
import { ExpenseFormFields } from '@/components/expenses/ExpenseFormFields';
import { ExpenseGroupManagerSheet } from '@/components/expenses/ExpenseGroupManagerSheet';
import { toExpenseCategoryOrNull } from '@/components/expenses/expense-categories';
import {
  dependencyErrorMessage,
  findHistoricalGroup,
  formDisabled,
  isFatalDependencyError,
} from '@/components/expenses/expense-edit-form-dependencies';
import { submitExpenseEdit } from '@/components/expenses/expense-edit-form-save';
import { expenseFormStyles } from '@/components/expenses/expense-form.styles';
import { AppFormScreen } from '@/components/ui/AppFormScreen';
import { useBranches } from '@/hooks/useBranches';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useExpenseFormHandlers } from '@/hooks/useExpenseFormHandlers';
import { useExpenseFormState } from '@/hooks/useExpenseFormState';
import { useExpenseGroups } from '@/hooks/useExpenseGroups';
import { useExpenseReceiptUrl } from '@/hooks/useExpenseReceiptUrl';
import { useMerchant } from '@/hooks/useMerchant';
import { useSaveExpense } from '@/hooks/useSaveExpense';
import { useTheme } from '@/hooks/useTheme';
import { parseExpenseAmount } from '@/lib/expense-amount';
import type { ExpenseDetail } from '@/schemas/expense-detail';

export function ExpenseEditForm({
  canEdit = false,
  expense,
  isRefreshing = false,
  onReload,
}: {
  canEdit?: boolean;
  expense: ExpenseDetail & { amountWasLegacySpecial?: boolean };
  isRefreshing?: boolean;
  onReload: () => void;
}) {
  const { colors } = useTheme();
  const { merchant } = useMerchant();
  const { scope } = useBranchScope();
  const {
    data: branchesData,
    error: branchesError,
    isLoading: branchesLoading,
    refetch: refetchBranches,
  } = useBranches({
    includeInactive: true,
  });
  const {
    activeGroups,
    allGroups,
    archiveGroup: archiveGroupMutation,
    createGroup,
    hasCachedGroups,
    renameGroup,
    error: groupsError,
    refetch: refetchGroups,
  } = useExpenseGroups();
  const branches = branchesData ?? [];
  const fatalBranchesError = isFatalDependencyError(
    branchesError,
    branchesData !== undefined
  );
  const fatalGroupsError = isFatalDependencyError(groupsError, hasCachedGroups);
  const receipt = useExpenseReceiptUrl({
    legacyReceiptUrl: expense.receipt_url,
    merchantId: merchant?.id ?? '',
    receiptStoragePath: expense.receipt_storage_path,
  });
  const saveExpense = useSaveExpense();
  const router = useRouter();
  const form = useExpenseFormState({
    initialUpdatedAt: expense.updated_at,
    initialValues: {
      amount: expense.amount,
      branchId: expense.branch_id,
      category: expense.category,
      date: expense.date,
      description: expense.description,
      groupId: expense.group_id,
      paymentMethod: expense.payment_method,
      reference: expense.reference,
      vendorName: expense.vendor_name,
    },
    originalLegacyReceiptUrl: expense.receipt_url,
    originalReceiptStoragePath: expense.receipt_storage_path,
  });
  const [amountText, setAmountText] = useState(String(expense.amount));
  const [categorySheetVisible, setCategorySheetVisible] = useState(false);
  const [groupManagerVisible, setGroupManagerVisible] = useState(false);
  const branchOptions = branches
    .filter((branch) => branch.active || branch.id === expense.branch_id)
    .map(({ id, name, active }) => ({
      id,
      name: active ? name : `${name} (inactive)`,
    }));
  const selectedBranchId =
    scope.type === 'branch' ? scope.branchId : form.values.branchId;
  const selectedCategory = toExpenseCategoryOrNull(form.values.category);
  const legacyCategoryLabel =
    selectedCategory === null &&
    typeof form.values.category === 'string' &&
    form.values.category.trim().length > 0
      ? form.values.category
      : null;
  const displayCategory = selectedCategory ?? legacyCategoryLabel;
  const historicalGroup = findHistoricalGroup(allGroups, expense.group_id);
  const disabled = formDisabled(
    saveExpense.isPending,
    branchesLoading,
    fatalBranchesError,
    fatalGroupsError,
    isRefreshing,
    receipt.isLoading
  );
  const { archiveGroup, close, navigateBackAfterSave, pickReceipt } =
    useExpenseFormHandlers({
      archiveGroupMutation,
      form,
      onNavigateBack: router.back,
      originalGroupId: expense.group_id,
    });
  if (fatalBranchesError || fatalGroupsError) {
    const errorMessage = dependencyErrorMessage(
      fatalBranchesError ? branchesError : null,
      fatalGroupsError ? groupsError : null
    );
    return (
      <ExpenseDependencyError
        colors={colors}
        message={errorMessage ?? 'Could not load expense dependencies.'}
        onRetry={() => {
          if (fatalBranchesError) void refetchBranches();
          if (fatalGroupsError) void refetchGroups();
        }}
      />
    );
  }
  const save = () => {
    if (!merchant?.id) return;
    submitExpenseEdit({
      activeGroups,
      branches,
      expense,
      form,
      merchantId: merchant.id,
      onReload,
      onSuccess: navigateBackAfterSave,
      originalGroupId: expense.group_id,
      saveExpense,
      selectedBranchId: selectedBranchId || null,
    });
  };
  return (
    <>
      <ExpenseEditHeader colors={colors} onClose={close} />
      <AppFormScreen
        contentContainerStyle={expenseFormStyles.content}
        edges={['bottom']}
        footer={
          <ExpenseEditFormFooter
            colors={colors}
            disabled={disabled}
            isDirty={form.isDirty}
            isPending={saveExpense.isPending}
            onSave={save}
          />
        }
        style={{ backgroundColor: colors.background }}
      >
        {historicalGroup ? (
          <Text style={{ color: colors.textSecondary }}>
            {historicalGroup.name} (archived)
          </Text>
        ) : null}
        <ExpenseFormFields
          activeGroups={activeGroups}
          amount={amountText}
          branches={scope.type === 'all' ? branchOptions : undefined}
          canEditGroups={canEdit}
          date={form.values.date}
          description={form.values.description ?? ''}
          disabled={disabled}
          existingReceiptUri={receipt.url}
          receiptError={receipt.error}
          receiptLoading={receipt.isLoading}
          hasExistingReceipt={Boolean(
            expense.receipt_storage_path || expense.receipt_url
          )}
          onAmountChange={(value) => {
            setAmountText(value);
            form.setField('amount', parseExpenseAmount(value));
          }}
          onBranchChange={(branchId) => form.setField('branchId', branchId)}
          onDateChange={(date) => form.setField('date', date)}
          onDescriptionChange={(description) =>
            form.setField('description', description || null)
          }
          onGroupChange={(groupId) => form.setField('groupId', groupId)}
          onManageGroups={() => setGroupManagerVisible(true)}
          onOpenCategorySheet={() => setCategorySheetVisible(true)}
          onPaymentMethodChange={(paymentMethod) =>
            form.setField('paymentMethod', paymentMethod || null)
          }
          onReceiptPress={() => {
            void pickReceipt();
          }}
          onReceiptRemove={form.removeReceipt}
          onReceiptRestore={form.restoreReceipt}
          onReferenceChange={(reference) =>
            form.setField('reference', reference || null)
          }
          onVendorNameChange={(vendorName) =>
            form.setField('vendorName', vendorName || null)
          }
          paymentMethod={form.values.paymentMethod ?? ''}
          receiptChange={form.receiptChange}
          receiptUri={form.receiptPreviewUri}
          reference={form.values.reference ?? ''}
          selectedBranchId={selectedBranchId || null}
          selectedCategory={displayCategory}
          selectedGroupId={form.values.groupId}
          vendorName={form.values.vendorName ?? ''}
        />
      </AppFormScreen>
      <ExpenseCategorySheet
        onClose={() => setCategorySheetVisible(false)}
        onSelect={(category) => {
          form.setField('category', category);
          setCategorySheetVisible(false);
        }}
        selectedCategory={selectedCategory}
        visible={categorySheetVisible}
      />
      <ExpenseGroupManagerSheet
        archiveGroup={archiveGroup}
        canEdit={canEdit}
        createGroup={createGroup}
        groups={allGroups}
        onClose={() => setGroupManagerVisible(false)}
        renameGroup={renameGroup}
        visible={groupManagerVisible}
      />
    </>
  );
}
