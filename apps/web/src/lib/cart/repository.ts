import type {
  CartCommand,
  CartErrorCode,
  CartInputLine,
  CartState,
} from '@baci/shared/cart';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RawCartLine {
  id: string;
  productId: string;
  variantId: string | null;
  condition: string | null;
  options: Record<string, string>;
  quantity: number;
  negotiatedUnitPriceMinor: number | null;
  negotiationStatus: string | null;
  negotiationInvalidated: boolean;
  voucherToken: string | null;
  voucherAwardId: string | null;
  hasAssurance: boolean;
  assuranceRate: number | null;
  unitPriceMinor: number;
  available: boolean;
  stockQty: number | null;
  manageStock: boolean;
}

export interface RawCartState {
  cartId: string;
  merchantId: string;
  state: CartState;
  version: number;
  lines: RawCartLine[];
  currency: string;
  expiresAt: string;
  checkoutSessionId: string | null;
  replayed: boolean;
}

export interface RawMutationResult {
  ok: boolean;
  code: CartErrorCode | null;
  state: RawCartState | null;
  replayed: boolean;
  /**
   * Live cart version at response time. Lets callers detect that a
   * replayed outcome is older than current state without another read.
   */
  currentVersion: number | null;
}

export interface MutateCartArgs {
  cartId: string;
  operationId: string;
  expectedVersion: number;
  command: CartCommand;
}

export interface CreateCartArgs {
  operationId: string;
  lines?: CartInputLine[];
  currency?: string;
}

export class CartRepositoryError extends Error {
  code: CartErrorCode;
  constructor(code: CartErrorCode, message: string) {
    super(message);
    this.name = 'CartRepositoryError';
    this.code = code;
  }
}

const ERROR_CODES: ReadonlySet<string> = new Set([
  'unauthorized',
  'not_found',
  'expired',
  'version_conflict',
  'idempotency_conflict',
  'invalid_item',
  'cart_locked',
  'refresh_required',
  'temporarily_unavailable',
  'rate_limited',
]);

const CART_STATES: ReadonlySet<string> = new Set([
  'active',
  'checkout',
  'completed',
  'expired',
  'canceled',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseLine(value: unknown): RawCartLine | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.productId !== 'string' ||
    typeof value.quantity !== 'number' ||
    !Number.isInteger(value.quantity) ||
    typeof value.unitPriceMinor !== 'number' ||
    !Number.isInteger(value.unitPriceMinor) ||
    typeof value.available !== 'boolean'
  ) {
    return null;
  }
  const options = isRecord(value.options)
    ? Object.fromEntries(
        Object.entries(value.options).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    : {};
  return {
    assuranceRate:
      typeof value.assuranceRate === 'number' ? value.assuranceRate : null,
    available: value.available,
    condition: typeof value.condition === 'string' ? value.condition : null,
    hasAssurance: value.hasAssurance === true,
    id: value.id,
    manageStock: value.manageStock !== false,
    negotiatedUnitPriceMinor:
      typeof value.negotiatedUnitPriceMinor === 'number' &&
      Number.isInteger(value.negotiatedUnitPriceMinor)
        ? value.negotiatedUnitPriceMinor
        : null,
    negotiationInvalidated: value.negotiationInvalidated === true,
    negotiationStatus:
      typeof value.negotiationStatus === 'string'
        ? value.negotiationStatus
        : null,
    options,
    productId: value.productId,
    quantity: value.quantity,
    stockQty: typeof value.stockQty === 'number' ? value.stockQty : null,
    unitPriceMinor: value.unitPriceMinor,
    variantId: typeof value.variantId === 'string' ? value.variantId : null,
    voucherAwardId:
      typeof value.voucherAwardId === 'string' ? value.voucherAwardId : null,
    voucherToken:
      typeof value.voucherToken === 'string' ? value.voucherToken : null,
  };
}

function parseState(value: unknown): RawCartState | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.cartId !== 'string' ||
    typeof value.merchantId !== 'string' ||
    typeof value.state !== 'string' ||
    !CART_STATES.has(value.state) ||
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version) ||
    !Array.isArray(value.lines) ||
    typeof value.currency !== 'string' ||
    typeof value.expiresAt !== 'string'
  ) {
    return null;
  }
  const lines: RawCartLine[] = [];
  for (const entry of value.lines) {
    const parsed = parseLine(entry);
    if (!parsed) return null;
    lines.push(parsed);
  }
  return {
    cartId: value.cartId,
    checkoutSessionId:
      typeof value.checkoutSessionId === 'string'
        ? value.checkoutSessionId
        : null,
    currency: value.currency,
    expiresAt: value.expiresAt,
    lines,
    merchantId: value.merchantId,
    replayed: value.replayed === true,
    state: value.state as CartState,
    version: value.version,
  };
}

function parseResult(data: unknown): RawMutationResult {
  if (!isRecord(data) || typeof data.ok !== 'boolean') {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Unparseable cart result'
    );
  }
  const code =
    typeof data.code === 'string' && ERROR_CODES.has(data.code)
      ? (data.code as CartErrorCode)
      : null;
  if (!data.ok && !code) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Unparseable cart failure'
    );
  }
  const state =
    data.state === null || data.state === undefined
      ? null
      : parseState(data.state);
  if (data.ok && !state) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Successful cart result without state'
    );
  }
  if (data.state !== null && data.state !== undefined && !state) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Unparseable cart state'
    );
  }
  return {
    code,
    currentVersion:
      typeof data.currentVersion === 'number' &&
      Number.isInteger(data.currentVersion)
        ? data.currentVersion
        : null,
    ok: data.ok,
    replayed: data.replayed === true,
    state,
  };
}

async function callCartRpc(
  client: SupabaseClient,
  name: string,
  params: Record<string, unknown>
): Promise<RawMutationResult> {
  let response: { data: unknown; error: unknown };
  try {
    response = (await client.rpc(name, params)) as {
      data: unknown;
      error: unknown;
    };
  } catch {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      `Cart RPC ${name} failed`
    );
  }
  if (response.error) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      `Cart RPC ${name} failed`
    );
  }
  return parseResult(response.data);
}

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
