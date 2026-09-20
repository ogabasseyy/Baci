import { Alert } from 'react-native';
import { resolvePersistedRedvaultOrder } from '@/lib/pending-redvault-order';
import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';

/**
 * Resolves a persisted REDVAULT fence before a non-REDVAULT submit. After
 * an app kill the in-memory review is gone while the old order may still
 * fence inventory (and may capture), so the server order is validated
 * before checkout proceeds. Returns true when checkout may proceed.
 */
export async function resolveCheckoutRedvaultFence(): Promise<boolean> {
  try {
    const fenceClient = createStorefrontCustomerApiClient();
    const fenced = await resolvePersistedRedvaultOrder({
      validateOrder: (orderId) =>
        fenceClient.fetchJson({
          method: 'GET',
          path: `/api/storefront/account/orders/${orderId}`,
        }),
    });
    if (fenced.blocked) {
      Alert.alert(
        'Payment still processing',
        'Your UBA payment is still being verified. Please wait for it to complete before paying another way.'
      );
      return false;
    }
  } catch {
    Alert.alert(
      'Unable to verify pending payment',
      'We could not check your pending UBA payment. Please try again.'
    );
    return false;
  }
  return true;
}
