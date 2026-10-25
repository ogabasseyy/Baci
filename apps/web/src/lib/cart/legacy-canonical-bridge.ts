import 'server-only';
import { createHash } from 'node:crypto';
import type { CartCommand, CartErrorCode } from '@baci/shared/cart';
import { legacyOwnerContextSchema } from '@/schemas/cart-legacy-bridge';
import {
  getCartProofEnvironment,
  getCartSessionSecret,
} from './cart-runtime-env';
import { issueCartHandoff } from './handoff';
import {
  hashLegacyToken,
  type LegacyCartProvider,
  migrateLegacyCart,
} from './legacy-migration';
import { createLegacyOwnerScopedClient } from './legacy-scoped-client';
import type { CartPrincipal } from './principal';
import { ERROR_CODES, rpcGetCart, rpcMutateCart } from './repository';
import { createCartScopedClient } from './scoped-client';

export class LegacyBridgeError extends Error {
  constructor(readonly code: CartErrorCode) {
    super('Legacy cart request unavailable');
  }
}

export interface LegacyBridgeOwner {
  provider: LegacyCartProvider;
  handle: string;
  agentId?: string | null;
  merchant: {
    id: string;
    slug: string;
    customDomain?: string | null;
    rootDomain?: string;
  };
}
export interface LegacyBridgeEdit {
  productId: string;
  offerId?: string;
  quantity: number;
}
const defaults = {
  assertConfig: () => {
    if ((getCartSessionSecret()?.trim().length ?? 0) < 32)
      throw new Error('Cart proof configuration unavailable');
  },
  ownerClient: createLegacyOwnerScopedClient,
  sessionClient: createCartScopedClient,
  migrate: migrateLegacyCart,
  read: rpcGetCart,
  mutate: rpcMutateCart,
  handoff: issueCartHandoff,
};

/** The legacy capability is the durable recovery handle; only the broker mints proofs. */
export async function openLegacyCanonicalCart(
  owner: LegacyBridgeOwner,
  deps = defaults
) {
  const hash = hashLegacyToken(owner.handle);
  const principalId = `legacy:${owner.provider}:${createHash('sha256')
    .update(`${owner.merchant.id}|${owner.agentId ?? ''}|${owner.handle}`)
    .digest('hex')}`;
  const bootstrap: CartPrincipal = {
    merchantId: owner.merchant.id,
    cartId: null,
    grantId: null,
    principalId,
    scope: 'bootstrap',
    allowedOperations: [],
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };
  deps.assertConfig();
  const client = deps.ownerClient(bootstrap, {
    provider: owner.provider,
    hash,
    agentId: owner.agentId,
  });
  async function context() {
    const r = await client.rpc('commerce_cart_legacy_owner_context', {
      p_provider: owner.provider,
      p_hash: hash,
    });
    if (r.error) throw new LegacyBridgeError('temporarily_unavailable');
    const parsed = legacyOwnerContextSchema.parse(r.data);
    if (!parsed.ok)
      throw new LegacyBridgeError(
        ERROR_CODES.has(parsed.code ?? '')
          ? (parsed.code as CartErrorCode)
          : 'unauthorized'
      );
    return parsed;
  }
  let current = await context();
  const migrated = Boolean(current.cartId);
  if (!migrated) {
    if (!current.lines || !current.legacyVersion || !current.currency)
      throw new Error('Invalid legacy owner context');
    const migration = await deps.migrate(client, {
      provider: owner.provider,
      legacyTokenHash: hash,
      operationId: `legacy-migrate:${hash}`,
      lines: current.lines,
      legacyVersion: current.legacyVersion,
      currency: current.currency,
    });
    if (!migration.ok)
      throw new LegacyBridgeError(migration.code ?? 'refresh_required');
    current = await context();
  }
  if (
    !current.cartId ||
    !current.grantId ||
    !current.grantExpiresAt ||
    !current.allowedOperations
  )
    throw new Error('Legacy cart authority unavailable');
  const principal: CartPrincipal = {
    ...bootstrap,
    cartId: current.cartId,
    grantId: current.grantId,
    scope: 'session',
    allowedOperations: current.allowedOperations,
    expiresAt: current.grantExpiresAt,
  };
  const session = deps.sessionClient(principal);
  const read = await deps.read(session, current.cartId);
  if (!read.ok || !read.state)
    throw new LegacyBridgeError(read.code ?? 'refresh_required');
  return {
    principal,
    client: session,
    state: read.state,
    migrated,
    owner,
    deps,
    recoverAuthority: context,
  };
}

/** Read-only liveness probe for a legacy capability; never migrates, mutates, or issues a credential. */
export async function probeLegacyCanonicalCart(
  owner: LegacyBridgeOwner,
  deps = defaults
): Promise<boolean> {
  const hash = hashLegacyToken(owner.handle);
  const principalId = `legacy:${owner.provider}:${createHash('sha256')
    .update(`${owner.merchant.id}|${owner.agentId ?? ''}|${owner.handle}`)
    .digest('hex')}`;
  deps.assertConfig();
  const client = deps.ownerClient(
    {
      merchantId: owner.merchant.id,
      cartId: null,
      grantId: null,
      principalId,
      scope: 'bootstrap',
      allowedOperations: [],
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    },
    { provider: owner.provider, hash, agentId: owner.agentId }
  );
  const r = await client.rpc('commerce_cart_legacy_owner_context', {
    p_provider: owner.provider,
    p_hash: hash,
  });
  if (r.error) throw new LegacyBridgeError('temporarily_unavailable');
  return legacyOwnerContextSchema.parse(r.data).ok;
}

export async function operateLegacyCanonicalCart(
  cart: Awaited<ReturnType<typeof openLegacyCanonicalCart>>,
  input: {
    edit?: LegacyBridgeEdit;
    command?: CartCommand;
    expectedVersion?: number;
    operationId?: string;
    handoff?: boolean;
  }
) {
  let state = cart.state;
  let command = input.command;
  let operationId = input.operationId;
  if (input.edit) {
    const edit = input.edit;
    const candidates = state.lines.filter((x) => {
      if (x.productId !== edit.productId) return false;
      if (!edit.offerId) return true;
      return x.offerId === edit.offerId;
    });
    if (
      candidates.length > 1 ||
      candidates.some(
        (x) =>
          x.variantId ||
          x.condition ||
          x.voucherToken ||
          x.voucherAwardId ||
          Object.keys(x.options ?? {}).length
      )
    )
      throw new LegacyBridgeError('refresh_required');
    const line = candidates[0];
    command =
      input.edit.quantity === 0
        ? line
          ? { type: 'remove', lineId: line.id }
          : undefined
        : line
          ? {
              type: 'set_quantity',
              lineId: line.id,
              quantity: input.edit.quantity,
            }
          : {
              type: 'add',
              item: {
                productId: input.edit.productId,
                ...(input.edit.offerId ? { offerId: input.edit.offerId } : {}),
              },
              quantity: input.edit.quantity,
            };
  }
  if (command) {
    operationId =
      input.operationId ??
      `legacy-write:${createHash('sha256')
        .update(JSON.stringify([state.cartId, state.version, command]))
        .digest('hex')}`;
    const result = await cart.deps.mutate(cart.client, {
      cartId: state.cartId,
      command,
      expectedVersion: input.expectedVersion ?? state.version,
      operationId,
    });
    if (!result.ok || !result.state) return { ...result, continueUrl: null };
    // A successful idempotent receipt may describe an earlier revision.
    // Publish the current authoritative cart before issuing its handoff.
    const latest = await cart.deps.read(cart.client, state.cartId);
    if (!latest.ok || !latest.state)
      throw new LegacyBridgeError(latest.code ?? 'temporarily_unavailable');
    if (
      latest.state.cartId !== state.cartId ||
      latest.state.version <
        Math.max(
          cart.state.version,
          result.currentVersion ?? result.state.version
        )
    )
      throw new LegacyBridgeError('refresh_required');
    state = latest.state;
  }
  if (command) {
    const authority = await cart.recoverAuthority();
    if (
      authority.cartId !== state.cartId ||
      authority.grantId !== cart.principal.grantId ||
      !authority.grantExpiresAt
    )
      throw new LegacyBridgeError('refresh_required');
    cart.principal.expiresAt = authority.grantExpiresAt;
  }
  let continueUrl: string | null = null;
  if (input.handoff) {
    const issued = await cart.deps.handoff(
      {
        client: cart.client,
        environment: getCartProofEnvironment(),
        merchant: {
          slug: cart.owner.merchant.slug,
          customDomain: cart.owner.merchant.customDomain ?? null,
          rootDomain: cart.owner.merchant.rootDomain ?? 'usebaci.com',
        },
      },
      cart.principal,
      {
        operationId: `legacy-handoff:${createHash('sha256')
          .update(
            `${state.cartId}|${operationId ?? `read-window:${Math.floor(Date.now() / 240000)}`}`
          )
          .digest('hex')}`,
        destination: { type: 'web' },
      }
    );
    if (!issued.ok)
      throw new LegacyBridgeError(issued.code ?? 'temporarily_unavailable');
    continueUrl = issued.continueUrl ?? null;
  }
  // No session proof leaves the broker: the legacy capability holder
  // re-opens the cart on every call, and the handoff continueUrl is
  // the only web continuation credential. Returning a reusable proof
  // here would hand storefront cart API access to anyone who can read
  // this response, bypassing the broker's mediation.
  return {
    ok: true,
    code: null,
    state,
    continueUrl,
  };
}
