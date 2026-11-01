import 'server-only';

import { randomUUID } from 'node:crypto';
import { createImmediateNotificationRedriveClient } from './notification-redrive-client';

/** Binds all dispatch transitions to the original order and winning lease. */
export function createImmediateNotificationDispatch(input: {
  orderId: string;
  claimToken: string;
  env: Readonly<Record<string, string | undefined>>;
}) {
  const client = createImmediateNotificationRedriveClient(input.env);
  let dispatchToken: string | undefined;
  const transition = async (name: string) => {
    if (!dispatchToken)
      throw new Error('Immediate notification attempt is missing');
    const { data, error } = await client.rpc(name, {
      p_order_id: input.orderId,
      p_claim_token: input.claimToken,
      p_dispatch_token: dispatchToken,
    });
    if (error || data !== true) {
      throw new Error(
        'Immediate notification dispatch transition was not confirmed'
      );
    }
  };
  return {
    beforeTransportDispatch: () => {
      dispatchToken = randomUUID();
      return transition('begin_immediate_notification_dispatch');
    },
    resetTransportDispatch: () =>
      transition('release_immediate_notification_dispatch'),
    recordAcceptance: () =>
      transition('record_immediate_notification_acceptance'),
  };
}
