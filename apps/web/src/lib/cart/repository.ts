import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type CreateCartArgs,
  callCartRpc,
  type MutateCartArgs,
  type RawMutationResult,
} from './repository-envelope';

/**
 * Thin RPC boundary over the transactional cart operations. The client is
 * injected (a verified scoped client in production, a mock in tests), so
 * this module stays free of Next.js runtime dependencies for the
 * standalone MCP worker.
 */
export function rpcMutateCart(
  client: SupabaseClient,
  args: MutateCartArgs
): Promise<RawMutationResult> {
  return callCartRpc(client, 'commerce_cart_mutate', {
    p_cart_id: args.cartId,
    p_command: args.command,
    p_expected_version: args.expectedVersion,
    p_operation_id: args.operationId,
  });
}

export function rpcCreateCart(
  client: SupabaseClient,
  args: CreateCartArgs
): Promise<RawMutationResult> {
  return callCartRpc(client, 'commerce_cart_create', {
    p_currency: args.currency ?? 'NGN',
    p_lines: args.lines ?? [],
    p_operation_id: args.operationId,
  });
}

export function rpcGetCart(
  client: SupabaseClient,
  cartId: string
): Promise<RawMutationResult> {
  return callCartRpc(client, 'commerce_cart_snapshot', { p_cart_id: cartId });
}

export * from './repository-envelope';
