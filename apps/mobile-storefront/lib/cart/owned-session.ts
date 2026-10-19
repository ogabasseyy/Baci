import { NativeCartError } from './native-cart-error';
import { readNativeCartContext } from './session-context';
import type { CartSessionStorage } from './session-storage';

/** Local privacy fence only: the server still verifies proof and live grant authority. */
export async function readOwnedCartProof(
  storage: CartSessionStorage,
  merchant: string,
  ownerSubject?: string
): Promise<string | null> {
  const record = storage.getSession
    ? await storage.getSession(merchant)
    : {
        proof: await storage.get(merchant),
        ownerSubject: await storage.getOwnerSubject?.(merchant),
      };
  if (!record?.proof) return null;
  if (record.ownerSubject && record.ownerSubject !== ownerSubject)
    throw new NativeCartError('session_changed');
  if (!record.ownerSubject) {
    let actor: string | undefined;
    try {
      actor = readNativeCartContext(record.proof, merchant).actor;
    } catch {
      /* Invalid or expired proofs remain subject to server verification. */
    }
    if (actor?.startsWith('customer-device:'))
      throw new NativeCartError('session_changed');
  }
  return record.proof;
}
