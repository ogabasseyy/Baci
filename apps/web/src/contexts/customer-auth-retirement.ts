import { beginCartSessionRetirement } from '@/hooks/cart/cart-session-write-fence';
import { eraseRetiredCartCache } from '@/hooks/cart/retired-cart-cache';
import {
  clearCartDeviceRevocationPending,
  markCartDeviceRevocationPending,
  revokeCartDeviceSession,
} from '@/hooks/cart/shared-cart-session-revoke-client';
import { bumpCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { clearCartStorage } from '@/hooks/use-cart';
import { setRememberedCustomerUserId } from './customer-auth-storage';

/** Retire the previous account's cart authority before adopting a new one. */
export async function retirePreviousAccountCartAuthority(
  merchantSlug: string,
  previousUserId: string
): Promise<boolean> {
  const retirement = beginCartSessionRetirement(merchantSlug);
  markCartDeviceRevocationPending?.(merchantSlug);
  bumpCartSessionGeneration({ merchantSlug });
  try {
    await retirement.drained;
    const revoked = await revokeCartDeviceSession(merchantSlug, {
      retiringUserId: previousUserId,
    });
    if (!revoked.ok) {
      setRememberedCustomerUserId(merchantSlug, previousUserId);
      return false;
    }
    // Revocation can succeed while deliberately retaining the pending
    // marker because cache erasure failed. Only lift that fence once
    // the previous account's cache is verifiably gone; otherwise the
    // new account could adopt the surviving parked cart.
    const erased = eraseRetiredCartCache(merchantSlug, previousUserId);
    if (!erased) {
      // Retirement is not complete: retain the retiring identity so
      // a later retry can target its user-scoped keys, and let the
      // caller roll the auth session back instead of committing.
      setRememberedCustomerUserId(merchantSlug, previousUserId);
      return false;
    }
    clearCartStorage(merchantSlug, previousUserId);
    clearCartDeviceRevocationPending?.(merchantSlug);
    setRememberedCustomerUserId(merchantSlug, null);
    return true;
  } catch {
    setRememberedCustomerUserId(merchantSlug, previousUserId);
    return false;
  } finally {
    retirement.release();
  }
}
