import { supabase } from '@/lib/supabase';

interface ReceiptStorageRemover {
  removeOwned: (merchantId: string, storagePath: string) => Promise<void>;
}

interface RemoveUploadedReplacementOptions {
  expenseId?: string | null;
}

async function queuePrivateReceiptCleanup(
  merchantId: string,
  storagePath: string,
  expenseId?: string | null
): Promise<void> {
  if (expenseId) {
    const { error } = await supabase.rpc(
      'queue_expense_private_receipt_cleanup',
      {
        p_expense_id: expenseId,
        p_merchant_id: merchantId,
        p_storage_path: storagePath,
      }
    );
    if (error) {
      // Best-effort queue; the hourly worker can reconcile later.
    }
    return;
  }

  const { error } = await supabase.rpc(
    'queue_unreferenced_expense_private_receipt_cleanup',
    {
      p_merchant_id: merchantId,
      p_storage_path: storagePath,
    }
  );
  if (error) {
    // Best-effort queue; the hourly worker can reconcile later.
  }
}

export async function queueUploadedReceiptForCleanup(
  merchantId: string,
  storagePath: string
): Promise<void> {
  const { error } = await supabase.rpc(
    'queue_unreferenced_expense_private_receipt_cleanup',
    {
      p_merchant_id: merchantId,
      p_storage_path: storagePath,
    }
  );
  if (error) {
    throw new Error(error.message);
  }
}

export async function removeUploadedReplacement(
  storage: ReceiptStorageRemover,
  merchantId: string,
  storagePath: string | null,
  options: RemoveUploadedReplacementOptions = {}
): Promise<void> {
  if (!storagePath) return;

  try {
    await storage.removeOwned(merchantId, storagePath);
  } catch {
    await queuePrivateReceiptCleanup(
      merchantId,
      storagePath,
      options.expenseId
    );
  }
}
