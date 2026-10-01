import { useState } from 'react';
import { EXPENSE_CATEGORIES } from '@/components/expenses/expense-categories';
import { expenseDateCodec } from '@/lib/expense-date';
import type { ExpenseEditFormDraft } from '@/schemas/expense-form';

export type ExpenseReceiptChange =
  | { kind: 'unchanged' }
  | { kind: 'remove' }
  | {
      kind: 'replace';
      localUri: string;
      fileName?: string | null;
      mimeType?: string | null;
    };

interface ExpenseFormStateInput {
  initialBranchId?: string | null;
  initialValues?: Partial<ExpenseEditFormDraft>;
  originalLegacyReceiptUrl?: string | null;
  originalReceiptStoragePath?: string | null;
  initialUpdatedAt?: string;
}

interface ExpenseFormStateSnapshot {
  expectedUpdatedAt: string | null;
  originalLegacyReceiptUrl: string | null;
  originalReceiptStoragePath: string | null;
  values: ExpenseEditFormDraft;
}

const editableFields = [
  'amount',
  'branchId',
  'category',
  'date',
  'description',
  'groupId',
  'paymentMethod',
  'reference',
  'vendorName',
] as const;

function createSnapshot(
  input: ExpenseFormStateInput
): ExpenseFormStateSnapshot {
  const values = input.initialValues;

  return {
    expectedUpdatedAt: input.initialUpdatedAt ?? null,
    originalLegacyReceiptUrl: input.originalLegacyReceiptUrl ?? null,
    originalReceiptStoragePath: input.originalReceiptStoragePath ?? null,
    values: {
      amount: values?.amount ?? 0,
      branchId:
        values?.branchId !== undefined
          ? values.branchId
          : (input.initialBranchId ?? ''),
      category: values?.category ?? EXPENSE_CATEGORIES[0],
      date: values?.date ?? expenseDateCodec.toDateOnly(new Date()),
      description: values?.description ?? null,
      groupId: values?.groupId ?? null,
      paymentMethod: values?.paymentMethod ?? null,
      reference: values?.reference ?? null,
      vendorName: values?.vendorName ?? null,
    },
  };
}

function valuesMatch(
  left: ExpenseEditFormDraft,
  right: ExpenseEditFormDraft
): boolean {
  return editableFields.every((field) => left[field] === right[field]);
}

export function useExpenseFormState(input: ExpenseFormStateInput) {
  const [initialSnapshot, setInitialSnapshot] = useState(() =>
    createSnapshot(input)
  );
  const [values, setValues] = useState<ExpenseEditFormDraft>(
    () => initialSnapshot.values
  );
  const [receiptChange, setReceiptChange] = useState<ExpenseReceiptChange>({
    kind: 'unchanged',
  });

  const setField = <Field extends keyof ExpenseEditFormDraft>(
    field: Field,
    value: ExpenseEditFormDraft[Field]
  ) => {
    if (!editableFields.includes(field as (typeof editableFields)[number])) {
      return;
    }

    setValues((current) => ({ ...current, [field]: value }));
  };

  const setLocalReceipt = (
    localUri: string,
    metadata?: { fileName?: string | null; mimeType?: string | null }
  ) => {
    if (!localUri.trim()) return;
    setReceiptChange({ kind: 'replace', localUri, ...metadata });
  };

  const removeReceipt = () => {
    const hasOriginalReceipt = Boolean(
      initialSnapshot.originalLegacyReceiptUrl ||
        initialSnapshot.originalReceiptStoragePath
    );
    setReceiptChange(
      hasOriginalReceipt ? { kind: 'remove' } : { kind: 'unchanged' }
    );
  };

  const restoreReceipt = () => {
    setReceiptChange({ kind: 'unchanged' });
  };

  const reset = (nextInput?: ExpenseFormStateInput) => {
    const snapshot = nextInput ? createSnapshot(nextInput) : initialSnapshot;

    if (nextInput) {
      setInitialSnapshot(snapshot);
    }
    setValues(snapshot.values);
    setReceiptChange({ kind: 'unchanged' });
  };

  const receiptPreviewUri =
    receiptChange.kind === 'replace'
      ? receiptChange.localUri
      : receiptChange.kind === 'remove'
        ? null
        : initialSnapshot.originalLegacyReceiptUrl;
  const isDirty =
    !valuesMatch(values, initialSnapshot.values) ||
    receiptChange.kind !== 'unchanged';

  return {
    expectedUpdatedAt: initialSnapshot.expectedUpdatedAt,
    isDirty,
    originalLegacyReceiptUrl: initialSnapshot.originalLegacyReceiptUrl,
    originalReceiptStoragePath: initialSnapshot.originalReceiptStoragePath,
    receiptChange,
    receiptPreviewUri,
    removeReceipt,
    reset,
    restoreReceipt,
    setField,
    setLocalReceipt,
    values,
  };
}
