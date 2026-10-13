import { useQuery } from '@tanstack/react-query';
import { assertOwnedExpenseReceiptPath } from '@/lib/expense-receipt-path';
import { supabase } from '@/lib/supabase';

const RECEIPT_BUCKET = 'expense-receipts';
const SIGNED_URL_SECONDS = 5 * 60;
const SIGNED_URL_STALE_TIME = 4 * 60 * 1000;

function validLegacyUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function useExpenseReceiptUrl(input: {
  merchantId: string;
  receiptStoragePath: string | null;
  legacyReceiptUrl: string | null;
}): { url: string | null; isLoading: boolean; error: Error | null } {
  const { legacyReceiptUrl, merchantId, receiptStoragePath } = input;
  const hasPrivateReceipt = receiptStoragePath !== null;
  const query = useQuery({
    queryKey: ['expense-receipt-url', merchantId, receiptStoragePath],
    queryFn: async () => {
      if (!receiptStoragePath) {
        throw new Error('Receipt path is not owned by the active merchant');
      }
      assertOwnedExpenseReceiptPath(merchantId, receiptStoragePath);

      const { data, error } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .createSignedUrl(receiptStoragePath, SIGNED_URL_SECONDS);

      if (error || !data?.signedUrl) {
        throw new Error('Failed to create a private receipt URL');
      }

      return data.signedUrl;
    },
    enabled: hasPrivateReceipt,
    refetchInterval: SIGNED_URL_STALE_TIME,
    staleTime: SIGNED_URL_STALE_TIME,
  });

  const error =
    query.error instanceof Error && !query.data ? query.error : null;
  const url = hasPrivateReceipt
    ? (query.data ?? null)
    : validLegacyUrl(legacyReceiptUrl);

  return {
    error,
    isLoading: hasPrivateReceipt && query.isLoading,
    url,
  };
}
