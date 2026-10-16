import { createHash, randomUUID } from 'node:crypto';
import type { CartInputLine } from '@baci/shared/cart';
import {
  LegacyBridgeError,
  openLegacyCanonicalCart,
  operateLegacyCanonicalCart,
} from '@/lib/cart/legacy-canonical-bridge';
import { createAnonMerchantFeatureLookup } from '@/lib/cart/merchant-resolution';
import { buildCartSnapshot } from '@/lib/cart/pricing';
import { merchantHasFeature } from '@/lib/merchant-has-feature';
import { createAnonClient } from '@/lib/supabase/anon';
import { buildUcpCartResponse } from './ucp-cart-response';

interface Input {
  merchant: { id: string; slug: string; custom_domain?: string };
  cartId: string;
  agentId: string | null;
  action: 'create' | 'read' | 'update' | 'cancel' | 'checkout';
  lines?: CartInputLine[];
  operationId?: string;
  expectedVersion?: unknown;
  detailsRequireHandoff?: boolean;
}
const defaults = {
  enabled: async (id: string) => {
    const features = await createAnonMerchantFeatureLookup(createAnonClient())(
      id
    );
    if (!features) throw new Error('Merchant unavailable');
    return merchantHasFeature(features, 'shared_cart');
  },
  readOperationId: randomUUID,
  open: openLegacyCanonicalCart,
  operate: operateLegacyCanonicalCart,
};

/** Verified UCP caller -> canonical authority; enrolled errors never resume legacy writes. */
export async function handleCanonicalUcpCart(
  input: Input,
  deps = defaults
): Promise<{ body: Record<string, unknown>; status: number } | null> {
  try {
    if (!(await deps.enabled(input.merchant.id))) return null;
    if (!input.agentId)
      return { body: { error: 'Cart not found' }, status: 404 };
    if (
      input.expectedVersion !== undefined &&
      (!Number.isSafeInteger(input.expectedVersion) ||
        Number(input.expectedVersion) < 0)
    )
      return {
        body: { code: 'invalid_request', error: 'Invalid cart version' },
        status: 400,
      };
    const cart = await deps.open({
      provider: 'ucp',
      handle: input.cartId,
      agentId: input.agentId,
      merchant: {
        id: input.merchant.id,
        slug: input.merchant.slug,
        customDomain: input.merchant.custom_domain,
      },
    });
    const mutationIdentity =
      input.operationId ??
      JSON.stringify([
        input.cartId,
        cart.state.version,
        input.action,
        input.lines ?? null,
      ]);
    const operationId =
      input.action === 'read' && !input.operationId
        ? deps.readOperationId()
        : `ucp-${input.action}:${createHash('sha256').update(`${input.agentId}|${mutationIdentity}`).digest('hex')}`;
    const result = await deps.operate(cart, {
      ...(input.action === 'cancel'
        ? { command: { type: 'clear' as const } }
        : (input.action === 'update' || input.action === 'create') &&
            !input.detailsRequireHandoff &&
            input.lines
          ? { command: { type: 'replace' as const, lines: input.lines } }
          : {}),
      expectedVersion:
        typeof input.expectedVersion === 'number'
          ? input.expectedVersion
          : cart.state.version,
      operationId,
      // A plain read must not mint a redeemable handoff credential:
      // the continueUrl upgrades read access into a full session
      // proof at redemption. Only update/checkout flows hand off.
      handoff: input.action !== 'read',
    });
    if (!result.ok || !result.state)
      return {
        body: {
          code: result.code ?? 'refresh_required',
          error: 'Refresh your cart and try again',
          cart_id: input.cartId,
          canonical_cart_id: cart.state.cartId,
        },
        status: 409,
      };
    const { snapshot } = buildCartSnapshot(result.state);
    const body = {
      ...buildUcpCartResponse({
        cartId: input.cartId,
        continueUrl: result.continueUrl ?? '',
        currency: snapshot.currency,
        status:
          snapshot.state === 'completed'
            ? 'converted'
            : snapshot.state === 'checkout'
              ? 'active'
              : snapshot.state,
        lineItems: snapshot.lines.map((line) => ({
          id: line.id,
          item: {
            id: line.item.productId,
            product_id: line.item.productId,
            variant_id: line.item.variantId,
            // Full lane identity: a read-modify-replace client must be
            // able to resubmit the exact options and condition it read,
            // or sibling lanes collapse into one another.
            variant_attributes: line.item.options ?? {},
            ...(line.item.condition ? { condition: line.item.condition } : {}),
            quantity: line.quantity,
          },
          base_amount: line.lineTotalMinor,
          discount: 0,
          subtotal: line.lineTotalMinor,
          tax: 0,
          total: line.lineTotalMinor,
        })),
        totals: [
          {
            type: 'subtotal',
            display_text: 'Subtotal',
            amount: snapshot.subtotalMinor,
          },
          { type: 'total', display_text: 'Total', amount: snapshot.totalMinor },
        ],
      }),
      cart_id: input.cartId,
      canonical_cart_id: snapshot.cartId,
      cart_version: snapshot.version,
      ...(input.action === 'cancel' ? { code: 'cart_contents_cleared' } : {}),
      ...(input.detailsRequireHandoff
        ? {
            code: 'cart_details_require_handoff',
            error: 'Continue cart details using the cart link',
          }
        : {}),
      ...(input.action === 'checkout'
        ? {
            code: 'checkout_requires_handoff',
            error: 'Continue checkout using the cart link',
          }
        : {}),
    };
    return {
      body,
      status:
        input.action === 'checkout' || input.detailsRequireHandoff ? 409 : 200,
    };
  } catch (error) {
    if (
      error instanceof LegacyBridgeError &&
      ['unauthorized', 'not_found', 'expired'].includes(error.code)
    )
      return { body: { error: 'Cart not found' }, status: 404 };
    if (error instanceof LegacyBridgeError && error.code === 'refresh_required')
      return {
        body: {
          code: error.code,
          cart_id: input.cartId,
          error: 'Refresh your cart and try again',
        },
        status: 409,
      };
    return {
      body: {
        code: 'temporarily_unavailable',
        error: 'Shared cart unavailable',
      },
      status: 503,
    };
  }
}
