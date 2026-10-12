import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type {
  CartErrorCode,
  CartInputLine,
  CartItemIdentity,
  CartSnapshot,
} from '@baci/shared/cart';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCartSessionSecret } from './cart-runtime-env';
import { buildCartSnapshot } from './pricing';
import type { CartPrincipal } from './principal';
import { CartRepositoryError, parseRawMutationResult } from './repository';

export const HANDOFF_TOKEN_VERSION = 'ch1';
const HANDOFF_TOKEN_AUDIENCE = 'baci-cart-handoff';
const MIN_SECRET_LENGTH = 32;

export class HandoffConfigError extends Error {
  constructor() {
    super('Cart handoff secret is not provisioned');
    this.name = 'HandoffConfigError';
  }
}

export type HandoffDestinationType = 'web' | 'native';
export type HandoffMobileApp = 'storefront' | 'admin';

export interface HandoffDestination {
  type: HandoffDestinationType;
  /** Required for native destinations; validated against known apps. */
  app?: HandoffMobileApp;
}

export interface HandoffTokenInput {
  merchantId: string;
  cartId: string;
  principalId: string;
  operationId: string;
  destination: HandoffDestination;
}

interface HandoffTokenPayload extends HandoffTokenInput {
  v: typeof HANDOFF_TOKEN_VERSION;
  aud: typeof HANDOFF_TOKEN_AUDIENCE;
  env: string;
}

export type HandoffChoice = 'connect' | 'merge' | 'keep_existing';

export interface HandoffMerchantRef {
  slug: string;
  customDomain: string | null;
  rootDomain: string;
}

function requireSecret(secret: string | undefined): string {
  const normalized = secret?.trim() ? secret.trim() : getCartSessionSecret();
  if (!normalized || normalized.length < MIN_SECRET_LENGTH) {
    throw new HandoffConfigError();
  }
  return normalized;
}

function encodeCanonicalPayload(input: HandoffTokenInput, env: string): string {
  const payload: HandoffTokenPayload = {
    aud: HANDOFF_TOKEN_AUDIENCE,
    cartId: input.cartId,
    destination:
      input.destination.type === 'native'
        ? { app: input.destination.app as HandoffMobileApp, type: 'native' }
        : { type: 'web' },
    env,
    merchantId: input.merchantId,
    operationId: input.operationId,
    principalId: input.principalId,
    v: HANDOFF_TOKEN_VERSION,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function signTokenPayload(encoded: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${HANDOFF_TOKEN_VERSION}.${encoded}`)
    .digest('base64url');
}

function signaturesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'base64url');
  const rightBytes = Buffer.from(right, 'base64url');
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Mints a deterministic handoff grant token. Identical inputs yield the
 * identical token, so issue replays converge on one grant row without
 * storing any secret: the database keeps only the token hash. Expiry
 * and single-use live on the row, never in the token.
 */
export function createHandoffToken(
  input: HandoffTokenInput & { environment: string },
  secret?: string
): string {
  const resolved = requireSecret(secret);
  const encoded = encodeCanonicalPayload(input, input.environment);
  return `${HANDOFF_TOKEN_VERSION}.${encoded}.${signTokenPayload(encoded, resolved)}`;
}

/** Stable hex digest identifying a grant row. Never reversible. */
export function hashHandoffToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Verifies a handoff token and returns its bound inputs, or null when
 * the token is malformed, forged, or minted for another environment.
 */
export function parseHandoffToken(
  token: string,
  secret: string | undefined,
  environment: string
): HandoffTokenInput | null {
  const resolved = requireSecret(secret);
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HANDOFF_TOKEN_VERSION) return null;
  const [, encoded, signature] = parts;
  if (
    !encoded ||
    !signature ||
    !signaturesEqual(signTokenPayload(encoded, resolved), signature)
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.v !== HANDOFF_TOKEN_VERSION) return null;
  if (parsed.aud !== HANDOFF_TOKEN_AUDIENCE) return null;
  if (parsed.env !== environment) return null;
  const destination = parsed.destination;
  if (!isRecord(destination)) return null;
  if (destination.type === 'native') {
    if (destination.app !== 'storefront' && destination.app !== 'admin') {
      return null;
    }
  } else if (destination.type !== 'web') {
    return null;
  }
  for (const field of [
    'merchantId',
    'cartId',
    'principalId',
    'operationId',
  ] as const) {
    if (typeof parsed[field] !== 'string' || !parsed[field]) return null;
  }
  return {
    cartId: parsed.cartId as string,
    destination:
      destination.type === 'native'
        ? { app: destination.app as HandoffMobileApp, type: 'native' }
        : { type: 'web' },
    merchantId: parsed.merchantId as string,
    operationId: parsed.operationId as string,
    principalId: parsed.principalId as string,
  };
}

/**
 * Continuation URL for a handoff grant. The pairing secret travels in
 * the URL fragment, which browsers never send to the server — raw
 * secrets stay out of access logs. Follows the receipts-claim host
 * rule: custom domain first, else the slug subdomain.
 */
export function buildHandoffContinueUrl(
  merchant: HandoffMerchantRef,
  token: string,
  handoffId: string
): string {
  const host =
    merchant.customDomain?.trim().toLowerCase() ||
    `${merchant.slug}.${merchant.rootDomain}`.toLowerCase();
  return `https://${host}/cart#handoff=${encodeURIComponent(token)}&hid=${encodeURIComponent(handoffId)}`;
}

/**
 * Detects the redemption caller the same way the storefront auth
 * routes detect browser origins: an http(s) Origin header means web,
 * anything else (native fetch, curl) means native.
 */
export function detectHandoffCaller(
  origin: string | null
): HandoffDestinationType {
  return origin && /^https?:/i.test(origin) ? 'web' : 'native';
}

/**
 * Approved web origins for handoff redemption: the slug subdomain, the
 * merchant custom domain, the platform root host (slug storefronts),
 * and loopback for development. Mirrors the storefront auth origin
 * builder plus the shared root host.
 */
export function isHandoffWebOriginAllowed(
  origin: string | null,
  merchant: HandoffMerchantRef
): boolean {
  if (!origin) return false;
  const normalized = origin.trim().toLowerCase();
  const root = merchant.rootDomain.toLowerCase();
  const slug = merchant.slug.toLowerCase();
  const allowed = new Set([
    `https://${slug}.${root}`,
    `http://${slug}.${root}`,
    `https://${root}`,
    `http://${root}`,
    'http://localhost',
    'https://localhost',
    `http://127.0.0.1`,
    `https://127.0.0.1`,
  ]);
  if (merchant.customDomain?.trim()) {
    const custom = merchant.customDomain.trim().toLowerCase();
    allowed.add(`https://${custom}`);
    allowed.add(`http://${custom}`);
  }
  if (allowed.has(normalized)) return true;
  try {
    const url = new URL(normalized);
    const host = url.hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === `${slug}.localhost` ||
      host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

export interface IssueHandoffResult {
  ok: boolean;
  code?: CartErrorCode;
  continueUrl?: string;
  handoffId?: string;
  expiresAt?: string;
  replayed?: boolean;
}

export interface IssueHandoffDeps {
  client: SupabaseClient;
  secret?: string;
  environment: string;
  merchant: HandoffMerchantRef;
}

/**
 * Issues a handoff grant for an origin session principal. Sends only
 * the token hash to the database; operation records stay
 * credential-free and replays converge on the original grant.
 */
export async function issueCartHandoff(
  deps: IssueHandoffDeps,
  principal: CartPrincipal,
  input: { destination: HandoffDestination; operationId: string }
): Promise<IssueHandoffResult> {
  if (principal.scope !== 'session' || !principal.cartId) {
    return { code: 'unauthorized', ok: false };
  }
  if (input.destination.type !== 'web' && input.destination.type !== 'native') {
    return { code: 'invalid_item', ok: false };
  }
  if (
    input.destination.type === 'native' &&
    input.destination.app !== 'storefront' &&
    input.destination.app !== 'admin'
  ) {
    return { code: 'invalid_item', ok: false };
  }
  const operationId = input.operationId?.trim() ?? '';
  if (!operationId || operationId.length > 128) {
    return { code: 'invalid_item', ok: false };
  }

  const token = createHandoffToken(
    {
      cartId: principal.cartId,
      destination: input.destination,
      environment: deps.environment,
      merchantId: principal.merchantId,
      operationId,
      principalId: principal.principalId,
    },
    deps.secret
  );
  const handoffId = randomUUID();
  const response = await deps.client.rpc('commerce_cart_issue_handoff', {
    p_cart_id: principal.cartId,
    p_destination: input.destination,
    p_handoff_id: handoffId,
    p_operation_id: operationId,
    p_token_hash: hashHandoffToken(token),
  });
  if (response.error) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_issue_handoff failed'
    );
  }
  const data = response.data as Record<string, unknown> | null;
  if (!isRecord(data) || data.ok !== true) {
    const code = (isRecord(data) ? data.code : null) as CartErrorCode | null;
    return { code: code ?? 'temporarily_unavailable', ok: false };
  }
  const handoff = data.handoff;
  if (
    !isRecord(handoff) ||
    typeof handoff.id !== 'string' ||
    typeof handoff.expiresAt !== 'string'
  ) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_issue_handoff returned a malformed grant'
    );
  }
  return {
    continueUrl: buildHandoffContinueUrl(deps.merchant, token, handoff.id),
    expiresAt: handoff.expiresAt,
    handoffId: handoff.id,
    ok: true,
    replayed: data.replayed === true,
  };
}

export interface HandoffConflictView {
  item: CartItemIdentity;
  existing: Record<string, unknown>;
  incoming: Record<string, unknown>;
}

export type RedeemHandoffResult =
  | {
      ok: true;
      /** Null when keep-existing runs without a destination cart. */
      cart: CartSnapshot | null;
      grantId: string | null;
      choice: HandoffChoice;
      replayed: boolean;
      warnings: { code: string; message: string }[];
    }
  | {
      ok: false;
      code: CartErrorCode;
      cart?: CartSnapshot;
      conflicts?: HandoffConflictView[];
      incomingVersion?: number | null;
      destVersion?: number | null;
    };

export interface RedeemHandoffInput {
  token: string;
  handoffId: string;
  attemptId: string;
  choice: HandoffChoice;
  caller: HandoffDestinationType;
  destCartId?: string;
  expectedIncomingVersion?: number;
  expectedDestVersion?: number;
  lines?: CartInputLine[];
  resolutions?: { item: CartItemIdentity; keep: 'incoming' | 'existing' }[];
}

function parseConflicts(value: unknown): HandoffConflictView[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const conflicts: HandoffConflictView[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isRecord(entry.item)) return undefined;
    if (typeof entry.item.productId !== 'string') return undefined;
    const item: CartItemIdentity = { productId: entry.item.productId };
    if (typeof entry.item.variantId === 'string') {
      item.variantId = entry.item.variantId;
    }
    if (
      entry.item.condition === 'new' ||
      entry.item.condition === 'used' ||
      entry.item.condition === 'open_box' ||
      entry.item.condition === 'refurbished'
    ) {
      item.condition = entry.item.condition;
    }
    if (isRecord(entry.item.options)) {
      const options: Record<string, string> = {};
      for (const [key, option] of Object.entries(entry.item.options)) {
        if (typeof option === 'string') options[key] = option;
      }
      item.options = options;
    }
    conflicts.push({
      existing: isRecord(entry.existing) ? entry.existing : {},
      incoming: isRecord(entry.incoming) ? entry.incoming : {},
      item,
    });
  }
  return conflicts;
}

function parseVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Redeems a handoff grant for a destination attempt. The token is
 * hashed at the boundary: RPC arguments, receipts and logs see only
 * the hash. Successful outcomes price the resulting snapshot.
 */
export async function redeemCartHandoff(
  client: SupabaseClient,
  input: RedeemHandoffInput
): Promise<RedeemHandoffResult> {
  const response = await client.rpc('commerce_cart_redeem_handoff', {
    p_attempt_id: input.attemptId,
    p_caller: input.caller,
    p_choice: input.choice,
    p_dest_cart_id: input.destCartId ?? null,
    p_expected_dest_version: input.expectedDestVersion ?? null,
    p_expected_incoming_version: input.expectedIncomingVersion ?? null,
    p_handoff_id: input.handoffId,
    p_lines: input.lines ?? null,
    p_resolutions: input.resolutions ?? null,
    p_token_hash: hashHandoffToken(input.token),
  });
  if (response.error) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_redeem_handoff failed'
    );
  }
  const data = (response.data ?? {}) as Record<string, unknown>;
  if (data.ok === true && data.state == null) {
    const grantId =
      typeof data.grantId === 'string' && data.grantId ? data.grantId : null;
    return {
      cart: null,
      choice: input.choice,
      grantId,
      ok: true,
      replayed: data.replayed === true,
      warnings: [],
    };
  }
  const parsed = parseRawMutationResult(response.data);
  if (parsed.ok) {
    const priced = parsed.state ? buildCartSnapshot(parsed.state) : null;
    return {
      cart: priced ? priced.snapshot : null,
      choice: input.choice,
      grantId: parsed.grantId,
      ok: true,
      replayed: parsed.replayed,
      warnings: priced ? priced.warnings : [],
    };
  }
  const code = parsed.code ?? 'temporarily_unavailable';
  const priced = parsed.state ? buildCartSnapshot(parsed.state) : null;
  return {
    ...(priced ? { cart: priced.snapshot } : null),
    code,
    conflicts:
      code === 'merge_conflict' ? parseConflicts(data.conflicts) : undefined,
    destVersion: parseVersion(data.destVersion),
    incomingVersion: parseVersion(data.incomingVersion),
    ok: false,
  };
}

export type PreviewHandoffResult =
  | {
      ok: true;
      status: 'pending' | 'consumed' | 'expired';
      merchant: { id: string; slug: string | null } | null;
      snapshot: CartSnapshot | null;
      expiresAt: string | null;
      warnings: { code: string; message: string }[];
    }
  | { code: CartErrorCode; ok: false };

/**
 * Loads the unauthenticated continuation preview by public handoff id.
 * The id is a random capability, never the pairing secret.
 */
export async function rpcPreviewHandoff(
  client: SupabaseClient,
  handoffId: string
): Promise<PreviewHandoffResult> {
  const response = await client.rpc('commerce_cart_preview_handoff', {
    p_handoff_id: handoffId,
  });
  if (response.error) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_preview_handoff failed'
    );
  }
  const data = response.data as Record<string, unknown> | null;
  if (!isRecord(data)) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_preview_handoff returned malformed data'
    );
  }
  if (data.ok !== true) {
    const code = data.code as CartErrorCode | null;
    return { code: code ?? 'temporarily_unavailable', ok: false };
  }
  const status = data.status;
  if (status !== 'pending' && status !== 'consumed' && status !== 'expired') {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_preview_handoff returned an unknown status'
    );
  }
  const merchant = data.merchant;
  if (status !== 'pending') {
    return {
      expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
      merchant: null,
      ok: true,
      snapshot: null,
      status,
      warnings: [],
    };
  }
  const parsed = parseRawMutationResult({
    code: null,
    currentVersion: null,
    grantId: null,
    ok: true,
    replayed: false,
    state: data.snapshot ?? null,
  });
  if (!parsed.state) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_preview_handoff omitted the snapshot'
    );
  }
  const priced = buildCartSnapshot(parsed.state);
  return {
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
    merchant:
      isRecord(merchant) && typeof merchant.id === 'string'
        ? {
            id: merchant.id,
            slug: typeof merchant.slug === 'string' ? merchant.slug : null,
          }
        : null,
    ok: true,
    snapshot: priced.snapshot,
    status,
    warnings: priced.warnings,
  };
}
