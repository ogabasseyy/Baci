import { isTerminalClaimStatusToken } from '@baci/shared/insurance';
import { notifyCustomerWithStore } from '@/lib/expo-push-core';
import { activateProtectionMessage } from '@/lib/expo-push-messages';
import type { GiglNotificationRpcClient } from '@/lib/gigl-notification-worker-client';
import { createGiglNotificationPushStore } from './gigl-notification-push-store';

const DELIVERED_SHIPPING_STATUSES = new Set(['delivered', 'completed']);

interface ActivationCandidates {
  order_number: string;
  customer_id: string | null;
  shipping_status: string | null;
  customer_user_id: string | null;
  policies: { id: string; status: string; claim_status: string | null }[];
}

/**
 * Lease-bound twin of `maybeNotifyActivateProtection` for the GIGL delivered
 * customer notification: same eligibility, same atomic reminder claim, same
 * release-on-undelivered rule, but every read and write goes through the
 * notification wrappers for the order the caller currently leases.
 */
export async function notifyGiglDeliveredProtection(
  client: GiglNotificationRpcClient,
  lease: { notificationId: string; workerId: string },
  merchantId: string,
  orderId: string
): Promise<void> {
  const base = { p_id: lease.notificationId, p_worker_id: lease.workerId };
  const { data, error } = await client.rpc(
    'gigl_worker_notification_activation_candidates',
    base
  );
  if (error) {
    console.error('[ActivateProtection] candidate lookup failed:', error);
    return;
  }
  const candidates = data as ActivationCandidates | null;
  if (
    !candidates?.customer_id ||
    !DELIVERED_SHIPPING_STATUSES.has(String(candidates.shipping_status))
  ) {
    return;
  }
  const eligible = candidates.policies.filter(
    (policy) =>
      policy.status === 'active' &&
      !isTerminalClaimStatusToken(policy.claim_status)
  );
  if (eligible.length === 0 || !candidates.customer_user_id) return;

  const claimedIds: string[] = [];
  for (const policy of eligible) {
    const { data: claimed, error: claimError } = await client.rpc(
      'gigl_worker_claim_activation_reminder',
      { ...base, p_policy_id: policy.id }
    );
    if (claimError) {
      console.error('[ActivateProtection] claim update failed:', claimError);
      continue;
    }
    if (claimed === true) claimedIds.push(policy.id);
  }
  if (claimedIds.length === 0) return;

  const release = async (message: string) => {
    const { error: releaseError } = await client.rpc(
      'gigl_worker_release_activation_reminders',
      { ...base, p_policy_ids: claimedIds }
    );
    if (releaseError) console.error(message, releaseError);
  };

  const message = activateProtectionMessage(orderId, candidates.order_number);
  try {
    const result = await notifyCustomerWithStore(
      createGiglNotificationPushStore(client, lease),
      candidates.customer_user_id,
      message.title,
      message.body,
      message.data,
      'orders',
      { merchantId }
    );
    if (result.sent === 0) {
      await release(
        '[ActivateProtection] failed to release undelivered reminder claim:'
      );
    }
  } catch (sendError) {
    console.error('[ActivateProtection] push send failed:', sendError);
    await release(
      '[ActivateProtection] failed to release failed reminder claim:'
    );
  }
}
