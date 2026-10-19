import { walletKeys } from '@/hooks/wallet-query';
import { queryClient } from '@/lib/query-client';

export async function invalidateSavingsWalletCache({
  merchantId,
  ownerId,
}: {
  merchantId: string | null;
  ownerId: string | null;
}): Promise<void> {
  if (!merchantId || !ownerId) return;
  await queryClient.invalidateQueries({
    queryKey: walletKeys.data({ merchantId, ownerId }),
  });
}
