import { useMutation, useQueryClient } from '@tanstack/react-query';
import { legacyMediaPath } from '@/lib/expense-legacy-receipt';
import { expenseReceiptStorage } from '@/lib/expense-receipt';
import { assertOwnedExpenseReceiptPath } from '@/lib/expense-receipt-path';
import {
  queueUploadedReceiptForCleanup,
  removeUploadedReplacement,
} from '@/lib/expense-save-cleanup';
import { supabase } from '@/lib/supabase';
import type {
  ExpenseEditFormDraft,
  ExpenseFormDraft,
} from '@/schemas/expense-form';
import { SaveExpenseInputSchema } from '@/schemas/expense-save';
import type { ExpenseReceiptChange } from './useExpenseFormState';

const conflictMessage =
  'This expense changed elsewhere. Reload it before saving again.';

function isDefinitiveDatabaseError(error: { code?: string } | null): boolean {
  return Boolean(
    error?.code?.startsWith('22') || error?.code?.startsWith('23')
  );
}

export type SaveExpenseInput =
  | {
      merchantId: string;
      mode: 'create';
      receiptChange: ExpenseReceiptChange;
      values: ExpenseFormDraft;
    }
  | {
      expectedUpdatedAt: string;
      expenseId: string;
      merchantId: string;
      mode: 'edit';
      originalDescription?: string | null;
      originalAmount?: number;
      amountWasLegacySpecial?: boolean;
      originalBranchId?: string | null;
      originalCategory?: string;
      originalLegacyReceiptUrl: string | null;
      originalReceiptStoragePath: string | null;
      receiptChange: ExpenseReceiptChange;
      values: ExpenseEditFormDraft;
    };

export class ExpenseConflictError extends Error {
  constructor() {
    super(conflictMessage);
    this.name = 'ExpenseConflictError';
  }
}

function mutableExpensePayload(
  values: ExpenseFormDraft | ExpenseEditFormDraft,
  receiptStoragePath: string | null,
  receiptUrl: string | null,
  options: { omitAmount: boolean; omitBranchId: boolean }
) {
  return {
    ...(options.omitAmount ? {} : { amount: values.amount }),
    ...(options.omitBranchId ? {} : { branch_id: values.branchId }),
    category: values.category,
    date: values.date,
    description: values.description,
    group_id: values.groupId,
    payment_method: values.paymentMethod,
    receipt_storage_path: receiptStoragePath,
    receipt_url: receiptUrl,
    reference: values.reference,
    vendor_name: values.vendorName,
  };
}

interface ExpenseSaveCleanup {
  expenseId: string | null;
  merchantId: string;
  oldStoragePath: string | null;
  oldLegacyReceiptUrl: string | null;
}

interface ExpenseSaveResult {
  cleanup: ExpenseSaveCleanup;
  expense: unknown;
}

export function useSaveExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (rawInput: SaveExpenseInput) => {
      const input = SaveExpenseInputSchema.parse(rawInput);
      const originalReceiptStoragePath =
        input.mode === 'edit' ? input.originalReceiptStoragePath : null;
      const originalLegacyReceiptUrl =
        input.mode === 'edit' ? input.originalLegacyReceiptUrl : null;

      if (
        originalReceiptStoragePath &&
        input.receiptChange.kind === 'unchanged'
      ) {
        assertOwnedExpenseReceiptPath(
          input.merchantId,
          originalReceiptStoragePath
        );
      }

      let nextStoragePath = originalReceiptStoragePath;
      let nextLegacyUrl = originalLegacyReceiptUrl;

      if (input.receiptChange.kind === 'replace') {
        const upload = await expenseReceiptStorage.upload(
          input.merchantId,
          input.receiptChange.localUri,
          {
            fileName: input.receiptChange.fileName,
            mimeType: input.receiptChange.mimeType,
          }
        );
        nextStoragePath = upload.storagePath;
        nextLegacyUrl = null;
        try {
          await queueUploadedReceiptForCleanup(
            input.merchantId,
            nextStoragePath
          );
        } catch (queueError) {
          await removeUploadedReplacement(
            expenseReceiptStorage,
            input.merchantId,
            nextStoragePath,
            input.mode === 'edit' ? { expenseId: input.expenseId } : {}
          );
          throw queueError instanceof Error
            ? queueError
            : new Error('Could not queue uploaded receipt cleanup');
        }
      }

      if (input.receiptChange.kind === 'remove') {
        nextStoragePath = null;
        nextLegacyUrl = null;
      }

      const payload = mutableExpensePayload(
        input.values,
        nextStoragePath,
        nextLegacyUrl,
        {
          omitAmount:
            input.mode === 'edit' &&
            input.amountWasLegacySpecial === true &&
            input.values.amount === input.originalAmount,
          omitBranchId:
            input.mode === 'edit' &&
            input.originalBranchId == null &&
            input.values.branchId == null,
        }
      );
      const cleanup: ExpenseSaveCleanup = Object.freeze({
        expenseId: input.mode === 'edit' ? input.expenseId : null,
        merchantId: input.merchantId,
        oldStoragePath:
          input.mode === 'edit' && input.receiptChange.kind !== 'unchanged'
            ? originalReceiptStoragePath
            : null,
        oldLegacyReceiptUrl:
          input.mode === 'edit' && input.receiptChange.kind !== 'unchanged'
            ? originalLegacyReceiptUrl
            : null,
      });

      if (input.mode === 'create') {
        const { error } = await supabase
          .from('expenses')
          .insert({ ...payload, merchant_id: input.merchantId });

        if (error) {
          if (
            input.receiptChange.kind === 'replace' &&
            isDefinitiveDatabaseError(error)
          )
            await removeUploadedReplacement(
              expenseReceiptStorage,
              input.merchantId,
              nextStoragePath
            );
          throw new Error(error.message);
        }
        return { cleanup, expense: null } satisfies ExpenseSaveResult;
      }

      const { data, error } = await supabase
        .from('expenses')
        .update(payload)
        .eq('id', input.expenseId)
        .eq('merchant_id', input.merchantId)
        .eq('updated_at', input.expectedUpdatedAt)
        .select('id, updated_at')
        .maybeSingle();

      if (error) {
        if (
          input.receiptChange.kind === 'replace' &&
          isDefinitiveDatabaseError(error)
        )
          await removeUploadedReplacement(
            expenseReceiptStorage,
            input.merchantId,
            nextStoragePath,
            { expenseId: input.expenseId }
          );
        throw new Error(error.message);
      }
      if (!data) {
        if (input.receiptChange.kind === 'replace')
          await removeUploadedReplacement(
            expenseReceiptStorage,
            input.merchantId,
            nextStoragePath,
            { expenseId: input.expenseId }
          );
        throw new ExpenseConflictError();
      }
      return { cleanup, expense: data } satisfies ExpenseSaveResult;
    },
    retry: false,
    onSuccess: async ({ cleanup }: ExpenseSaveResult) => {
      if (cleanup.oldStoragePath && cleanup.expenseId) {
        try {
          await expenseReceiptStorage.removeOwned(
            cleanup.merchantId,
            cleanup.oldStoragePath
          );
        } catch {
          // Candidate captured transactionally during the expense update.
        }
      }
      if (cleanup.oldLegacyReceiptUrl) {
        const legacyPath = legacyMediaPath(
          cleanup.merchantId,
          cleanup.oldLegacyReceiptUrl
        );
        if (legacyPath) {
          try {
            const { error } = await supabase.rpc(
              'delete_legacy_expense_receipt',
              {
                p_expense_id: cleanup.expenseId,
                p_merchant_id: cleanup.merchantId,
                p_storage_path: legacyPath,
              }
            );
            if (error) throw error;
          } catch {
            // Persistence succeeded; legacy cleanup can be reconciled later.
          }
        }
      }

      await queryClient.invalidateQueries({
        queryKey: ['expenses', cleanup.merchantId],
      });
      if (cleanup.expenseId) {
        await queryClient.invalidateQueries({
          queryKey: ['expense', cleanup.merchantId],
        });
      }
    },
  });
}
