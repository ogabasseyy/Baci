import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { trackError } from '@/services/analytics';

/**
 * Attaches a guest REDVAULT checkout to the account created mid-checkout.
 * Guest signup establishes a session after the application was created with
 * a null user_id; without this step every customer-bound RPC rejects the
 * changed identity and the live order can neither replay nor verify. Runs
 * after the post-order side effects (which perform the signup) on both the
 * fresh review path and the resubmit-replay path.
 *
 * Recovery: when the attach fails under an established session, the new
 * identity can never verify the guest-owned attempt, so sign back out to
 * restore the guest context rather than stranding the payment.
 */
export async function attachRedvaultGuestOrderAfterSignup({
  orderId,
}: {
  orderId: string;
}): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const { error } = await supabase.rpc(
      'attach_redvault_guest_application_to_customer',
      { p_order_id: orderId }
    );
    if (error) throw error;
  } catch (attachError) {
    trackError(
      'redvault_guest_attach',
      attachError instanceof Error
        ? attachError.message
        : 'Failed to attach guest REDVAULT order'
    );
    try {
      await supabase.auth.signOut();
    } catch {
      // Best-effort: the alert below still explains the retry.
    }
    Alert.alert(
      'Account sync failed',
      'We could not link your new account to this UBA order. Please try verifying your payment again.'
    );
  }
}
