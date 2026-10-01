import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { trackError } from '@/services/analytics';
import { RedvaultInitializationError } from './redvault/redvault-initialization-error';

/**
 * Attaches a guest REDVAULT checkout to the account created mid-checkout.
 * Guest signup establishes a session after the application was created with
 * a null user_id; without this step every customer-bound RPC rejects the
 * changed identity and the live order can neither replay nor verify. Runs
 * inside the initialization success callback on both the fresh review path
 * and the resubmit-replay path, before gateway navigation.
 *
 * Recovery: when the attach fails under an established session, the new
 * identity can never verify the guest-owned attempt, so sign back out to
 * restore the guest context rather than stranding the payment. When the
 * guest context cannot be restored, this throws a definitive error so the
 * caller aborts gateway navigation instead of verifying under a foreign
 * identity.
 *
 * The RPC requires the order's tracking token as order-bound proof; without
 * it there is nothing to prove with, so skip the attach and keep the guest
 * context instead of failing the payment.
 */
export async function attachRedvaultGuestOrderAfterSignup({
  orderId,
  trackingToken,
}: {
  orderId: string;
  trackingToken?: string;
}): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session || !trackingToken) return;
    const { data, error } = await supabase.rpc(
      'attach_redvault_guest_application_to_customer',
      { p_order_id: orderId, p_tracking_token: trackingToken }
    );
    // The RPC is idempotent for the owning caller, so false means the
    // checkout is genuinely not ours (concurrent ownership or state
    // change): recover instead of navigating under a foreign identity.
    if (error) throw error;
    if (data !== true) throw new Error('Guest REDVAULT order was not attached');
  } catch (attachError) {
    trackError(
      'redvault_guest_attach',
      attachError instanceof Error
        ? attachError.message
        : 'Failed to attach guest REDVAULT order'
    );
    // signOut reports failure as a resolved { error }, not a rejection,
    // so inspect both the result and the session that remains: only a
    // truly restored guest context may proceed to gateway navigation.
    let guestRestored = false;
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (!signOutError) {
        const {
          data: { session: restoredSession },
        } = await supabase.auth.getSession();
        guestRestored = !restoredSession;
      }
    } catch {
      guestRestored = false;
    }
    if (!guestRestored) {
      trackError(
        'redvault_guest_attach_recovery',
        'Guest context was not restored after a failed attach'
      );
      Alert.alert(
        'Account sync failed',
        'We could not restore your guest checkout. Please restart the app and try again.'
      );
      throw new RedvaultInitializationError('definitive');
    }
    Alert.alert(
      'Account sync failed',
      'We could not link your new account to this UBA order. Please try verifying your payment again.'
    );
  }
}
