import { createHash } from 'node:crypto';
import type { CartInputLine } from '@baci/shared/cart';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CartRepositoryError,
  parseRawMutationResult,
  type RawMutationResult,
} from './repository';

export type LegacyCartProvider = 'mcp' | 'ucp';

export interface MigrateLegacyCartArgs {
  provider: LegacyCartProvider;
  legacyTokenHash: string;
  operationId: string;
  lines: CartInputLine[];
  legacyVersion: string;
  currency: string;
}

export class LegacyMigrationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyMigrationParseError';
  }
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Hashes a legacy handle (MCP token or UCP cart id) for ref lookups. Raw
 * handles never leave the adapter; only the hash reaches the RPC.
 */
export function hashLegacyToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Maps MCP guest lines one to one. Identity and quantity are preserved
 * exactly; pricing always comes from the catalog inside the RPC.
 */
export function mapMcpLinesToInput(
  lines: { product_id: string; offer_id?: string; quantity: number }[]
): CartInputLine[] {
  return lines.map((line) => {
    if (!UUID_PATTERN.test(line.product_id)) {
      throw new LegacyMigrationParseError('Legacy line is not a product UUID');
    }
    if (line.offer_id !== undefined && !UUID_PATTERN.test(line.offer_id)) {
      throw new LegacyMigrationParseError('Legacy line offer is not a UUID');
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new LegacyMigrationParseError('Legacy line quantity is invalid');
    }
    return {
      item: {
        productId: line.product_id,
        ...(line.offer_id ? { offerId: line.offer_id } : {}),
      },
      quantity: line.quantity,
    };
  });
}

/**
 * Maps UCP checkout items one to one. Unlike the lenient storefront
 * coercion, migration rejects unparseable entries instead of dropping
 * them: a migration must never silently lose lines.
 */
export function mapUcpLinesToInput(
  lines: { id: string; quantity: number }[]
): CartInputLine[] {
  return lines.map((line) => {
    if (typeof line.id !== 'string' || !UUID_PATTERN.test(line.id.trim())) {
      throw new LegacyMigrationParseError('Legacy line is not a product UUID');
    }
    if (
      typeof line.quantity !== 'number' ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1
    ) {
      throw new LegacyMigrationParseError('Legacy line quantity is invalid');
    }
    return {
      item: { productId: line.id.trim() },
      quantity: line.quantity,
    };
  });
}

/**
 * Runs the atomic legacy migration for a bootstrap principal. The client
 * is injected (a verified bootstrap-scoped client in production), keeping
 * this module free of Next.js runtime dependencies for the standalone
 * MCP worker.
 */
export async function migrateLegacyCart(
  client: SupabaseClient,
  args: MigrateLegacyCartArgs
): Promise<RawMutationResult> {
  let response: { data: unknown; error: unknown };
  try {
    response = (await client.rpc('commerce_cart_migrate_legacy', {
      p_currency: args.currency,
      p_legacy_token_hash: args.legacyTokenHash,
      p_legacy_version: args.legacyVersion,
      p_lines: args.lines,
      p_operation_id: args.operationId,
      p_provider: args.provider,
    })) as unknown as { data: unknown; error: unknown };
  } catch {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart migration RPC failed'
    );
  }
  if (response.error) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart migration RPC failed'
    );
  }
  return parseRawMutationResult(response.data);
}
