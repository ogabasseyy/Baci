export type PushPayload = Record<string, unknown>;

export type AdminNotificationNavigationTarget =
  | { screen: 'order'; params: { id: string } }
  | { screen: 'orders' }
  | { screen: 'product'; params: { id: string } }
  | { screen: 'products' }
  | { screen: 'notifications' }
  | { screen: 'negotiation'; params: { id: string } }
  | { screen: 'negotiations' }
  | { screen: 'repair'; params: { id: string } }
  | { screen: 'repairs' }
  | { screen: 'index' };

export type StorefrontNotificationNavigationTarget =
  | { screen: 'order-details'; params: { id: string } }
  | { screen: 'orders' }
  | { screen: 'repairs'; params?: { id: string } }
  | { screen: 'product'; params: { slug: string } }
  | { screen: 'category'; params: { slug: string } }
  | { screen: 'utility-history'; params: { type: StorefrontUtilityType } }
  | {
      screen: 'wallet';
      params?: {
        action?: 'savings';
        /**
         * Marks a target that came from an actual wallet CREDIT, as opposed to
         * the other pushes that also land on the wallet (savings reminder, VTU
         * cashback summary). Derived from the payload type on the client, so it
         * costs no wire-format change. Only a credit may consume the locally
         * stored funding intent — see `navigate-from-push-screen`.
         */
        credited?: 'true';
        returnTo?: string;
      };
    }
  | { screen: 'unlock-orders' }
  | { screen: 'home' };

type StorefrontUtilityType = 'airtime' | 'data' | 'gaming' | 'power' | 'tv';

export interface WalletCreditedPushPayload extends PushPayload {
  amount: number;
  currency: string;
  returnTo?: string;
  type: 'wallet_credited';
}

/**
 * The wallet-credited push contract shared by the web webhook (producer) and
 * the mobile navigation handler (consumer). `returnTo` is omitted — not sent
 * as undefined — when there is no interrupted purchase to resume.
 */
export function buildWalletCreditedPushPayload({
  amount,
  currency,
  returnTo,
}: {
  amount: number;
  currency: string;
  returnTo?: string;
}): WalletCreditedPushPayload {
  return {
    amount,
    currency,
    type: 'wallet_credited',
    ...(returnTo ? { returnTo } : {}),
  };
}

function readString(
  payload: PushPayload,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return undefined;
}

function readStorefrontUtilityType(
  payload: PushPayload,
  ...keys: string[]
): StorefrontUtilityType | undefined {
  const value = readString(payload, ...keys);
  switch (value) {
    case 'airtime':
    case 'data':
    case 'gaming':
    case 'power':
    case 'tv':
      return value;
    default:
      return undefined;
  }
}

export function getAdminNotificationNavigationTarget(
  payload: PushPayload | null | undefined
): AdminNotificationNavigationTarget | null {
  if (!payload) {
    return null;
  }

  const type = readString(payload, 'type');
  if (!type) {
    return null;
  }

  switch (type) {
    case 'new_order':
    case 'new_invoice':
    case 'payment_received':
    case 'shipment_tracking': {
      const orderId = readString(payload, 'order_id', 'orderId');
      return orderId
        ? { screen: 'order', params: { id: orderId } }
        : { screen: 'orders' };
    }
    case 'low_stock': {
      const productId = readString(payload, 'product_id', 'productId');
      return productId
        ? { screen: 'product', params: { id: productId } }
        : { screen: 'products' };
    }
    case 'admin_broadcast':
      return { screen: 'notifications' };
    case 'jumia_order':
      return { screen: 'orders' };
    case 'negotiation': {
      const negotiationId = readString(
        payload,
        'negotiation_id',
        'negotiationId'
      );
      return negotiationId
        ? { screen: 'negotiation', params: { id: negotiationId } }
        : { screen: 'negotiations' };
    }
    case 'repair': {
      const repairId = readString(payload, 'repair_id', 'repairId');
      return repairId
        ? { screen: 'repair', params: { id: repairId } }
        : { screen: 'repairs' };
    }
    default:
      return { screen: 'index' };
  }
}

export function getStorefrontNotificationNavigationTarget(
  payload: PushPayload | null | undefined
): StorefrontNotificationNavigationTarget | null {
  if (!payload) {
    return null;
  }

  const type = readString(payload, 'type');
  if (!type) {
    return null;
  }

  switch (type) {
    case 'order_update':
    case 'insurance_activation':
    case 'shipment_tracking': {
      const orderId = readString(payload, 'orderId', 'order_id');
      return orderId
        ? { screen: 'order-details', params: { id: orderId } }
        : { screen: 'orders' };
    }
    case 'promotion': {
      const productSlug = readString(payload, 'productSlug', 'product_slug');
      if (productSlug) {
        return { screen: 'product', params: { slug: productSlug } };
      }

      const categorySlug = readString(payload, 'categorySlug', 'category_slug');
      return categorySlug
        ? { screen: 'category', params: { slug: categorySlug } }
        : { screen: 'home' };
    }
    case 'back_in_stock':
    case 'price_drop':
    case 'negotiation_response': {
      const productSlug = readString(payload, 'productSlug', 'product_slug');
      return productSlug
        ? { screen: 'product', params: { slug: productSlug } }
        : { screen: 'home' };
    }
    case 'vtu_cashback_monthly_summary':
      return { screen: 'wallet' };
    case 'customer_savings_reminder':
      return { screen: 'wallet', params: { action: 'savings' } };
    case 'wallet_credited': {
      // Newer clients deep-link to the wallet and, when the interrupted
      // purchase supplied one, carry a returnTo for onward navigation. Older
      // shared bundles lack this case and fall through to `default` (home).
      // `credited` is always set so the tap handler can tell a real credit apart
      // from the other wallet-bound pushes (`vtu_cashback_monthly_summary` and
      // `customer_savings_reminder`), which must NOT consume the pending funding
      // intent — doing so would both misfire a navigation and burn the intent
      // before the actual credit arrives.
      const returnTo = readString(payload, 'returnTo', 'return_to');
      return returnTo
        ? { screen: 'wallet', params: { credited: 'true', returnTo } }
        : { screen: 'wallet', params: { credited: 'true' } };
    }
    case 'carrier_unlock':
      return { screen: 'unlock-orders' };
    case 'vtu_token_ready': {
      const utilityType = readStorefrontUtilityType(
        payload,
        'utilityType',
        'utility_type'
      );
      return utilityType
        ? {
            screen: 'utility-history',
            params: { type: utilityType },
          }
        : { screen: 'home' };
    }
    case 'repair': {
      const repairId = readString(payload, 'repair_id', 'repairId');
      return repairId
        ? { screen: 'repairs', params: { id: repairId } }
        : { screen: 'repairs' };
    }
    default:
      return { screen: 'home' };
  }
}
