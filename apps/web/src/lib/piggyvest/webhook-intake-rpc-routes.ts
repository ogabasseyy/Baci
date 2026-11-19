import type { PiggyvestWebhookIntakeFunction } from './webhook-intake-executor';

type Row = Record<string, unknown>;

/**
 * RPC names the receiver's modules call, each mapped to the one restricted
 * function that answers it (see webhook-intake-client.ts). A null payload
 * refuses the call.
 */
export type RpcRoute = {
  fn: PiggyvestWebhookIntakeFunction;
  payload: (args: Row) => Row | null;
};

const pick = (args: Row, mapping: Record<string, string>): Row =>
  Object.fromEntries(Object.entries(mapping).map(([k, v]) => [v, args[k]]));

export const rpcRoutes: Record<string, RpcRoute> = {
  capture_piggyvest_webhook_delivery: {
    fn: 'capture_delivery',
    payload: (args) =>
      typeof args.p_command === 'object' &&
      args.p_command !== null &&
      !Array.isArray(args.p_command)
        ? (args.p_command as Row)
        : null,
  },
  // Inline completion only: the receiver never claims or fails a capture.
  resolve_piggyvest_webhook_capture: {
    fn: 'resolve_capture',
    payload: (args) =>
      args.p_claim_token === null &&
      args.p_state === 'processed' &&
      args.p_error === null
        ? { id: args.p_id, state: 'processed' }
        : null,
  },
  claim_piggyvest_webhook_event: {
    fn: 'claim_event',
    payload: (args) => pick(args, { p_event_id: 'event_id' }),
  },
  resolve_piggyvest_webhook_event: {
    fn: 'resolve_event',
    payload: (args) =>
      pick(args, {
        p_event_id: 'event_id',
        p_claim_token: 'claim_token',
        p_status: 'status',
        p_last_error: 'last_error',
      }),
  },
  allocate_plan_transfer_contribution: {
    fn: 'allocate_plan_transfer',
    payload: (args) =>
      pick(args, {
        p_customer_id: 'customer_id',
        p_merchant_id: 'merchant_id',
        p_amount_kobo: 'amount_kobo',
        p_provider_transaction_id: 'provider_transaction_id',
        p_idempotency_key: 'idempotency_key',
        p_provider_wallet_id: 'provider_wallet_id',
        p_provider_customer_id: 'provider_customer_id',
      }),
  },
  apply_staging_wallet_restriction: {
    fn: 'apply_staging_restriction',
    payload: (args) =>
      pick(args, {
        p_provider_wallet_id: 'wallet_id',
        p_restriction_status: 'status',
      }),
  },
  resolve_staging_wallet_owner: {
    fn: 'resolve_staging_owner',
    payload: (args) =>
      pick(args, {
        p_provider_wallet_id: 'provider_wallet_id',
        p_provider_customer_id: 'provider_customer_id',
      }),
  },
};
