import type { ScheduledNotificationWorkerClient } from './scheduled-notification-rpc.ts';

type ClaimOptions = {
  channels?: string[];
  expiresAt?: string | null;
  id?: string;
  message?: string;
  title?: string;
};

export function makeScheduledNotificationClaim(
  suffix: string,
  options: ClaimOptions = {}
) {
  const serial = suffix.padStart(3, '0');
  return {
    action_url: null,
    channels: options.channels ?? ['in_app'],
    delivery_claim_token: `123e4567-e89b-42d3-a456-${suffix.padStart(12, '0')}`,
    expires_at: options.expiresAt ?? null,
    id: options.id ?? `d8543bf1-5f03-4fd1-8a2a-2f7f1658c${serial}`,
    message: options.message ?? `Notification ${suffix}`,
    target_merchant_ids: [],
    target_segment: null,
    target_type: 'all',
    title: options.title ?? `Notification ${suffix}`,
  };
}

export type RpcCall = {
  args?: Record<string, unknown>;
  name: string;
};

export function makeScheduledNotificationTestClient(
  handleRpc: (
    name: string,
    args: Record<string, unknown> | undefined,
    calls: RpcCall[]
  ) => ReturnType<ScheduledNotificationWorkerClient['rpc']>
) {
  const calls: RpcCall[] = [];
  const client: ScheduledNotificationWorkerClient = {
    rpc: (name, args) => {
      calls.push({ args, name });
      return handleRpc(name, args, calls);
    },
  };
  return { calls, client };
}
