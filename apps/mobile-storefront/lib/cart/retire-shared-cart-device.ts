import { NativeCartError } from './native-cart-error';
import type { pendingCartRequest } from './pending-request';

/** Revokes this device's cart session, then drops any receipt that could replay old intent. */
export async function retireSharedCartDevice(
  retireDevice: (() => Promise<void>) | undefined,
  receipts: typeof pendingCartRequest,
  merchantId: string
): Promise<void> {
  if (!retireDevice) return;
  const clearPending = async () => {
    const pending = await receipts.read(merchantId);
    if (pending) await receipts.clear(merchantId, pending.operationId);
  };
  try {
    await retireDevice();
  } catch (error) {
    if (
      !(error instanceof NativeCartError) ||
      error.code !== 'revocation_pending'
    )
      throw error;
    await clearPending();
    throw error;
  }
  await clearPending();
}
