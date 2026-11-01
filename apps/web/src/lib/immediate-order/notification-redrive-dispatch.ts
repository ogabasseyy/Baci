import 'server-only';

import { createImmediateNotificationRedriveClient } from './notification-redrive-client';

/** Binds all dispatch transitions to the original order and winning lease. */
export function createImmediateNotificationDispatch(input: {
  orderId: string;
  claimToken: string;
  env: Readonly<Record<string, string | undefined>>;
}) {
  const client = createImmediateNotificationRedriveClient(input.env);
  const args = { p_order_id: input.orderId, p_claim_token: input.claimToken };
  const transition = async (name: string) => {
    const { data, error } = await client.rpc(name, args);
    if (error || data !== true) {
      throw new Error(
        'Immediate notification dispatch transition was not confirmed'
      );
    }
  };
  return {
    beforeTransportDispatch: () =>
      transition('begin_immediate_notification_dispatch'),
    resetTransportDispatch: () =>
      transition('release_immediate_notification_dispatch'),
    recordAcceptance: () =>
      transition('record_immediate_notification_acceptance'),
  };
}
