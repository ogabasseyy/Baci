import 'server-only';

import type {
  MerchantInboxCustomerBadge,
  MerchantInboxCustomerProfile,
} from '@baci/shared';
import { createChatCustomerLinkVerifier } from './chat-customer-link-token';
import { loadChatwootMerchantCurrency } from './merchant-currency';
import { MerchantInboxCustomerUnavailableError } from './merchant-inbox-customer-unavailable';
import type { resolveMerchantInboxRequest } from './merchant-inbox-request';

type Resolved = Extract<
  Awaited<ReturnType<typeof resolveMerchantInboxRequest>>,
  { ok: true }
>;
type Db = Resolved['supabase'];

type BadgeRow = {
  id: string;
  total_orders?: number | null;
  total_spent?: number | null;
};
type ProfileRow = BadgeRow & {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at?: string | null;
  loyalty_points?: number | null;
};

/** The badge read's own limit, so a page of the inbox cannot hang on it. */
const BADGE_READ_TIMEOUT_MS = 4_000;

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Order count and spend for the customers behind a page of chats. Only a link
 * the server signed for this store counts, and the customer row is read under
 * the caller's own access, scoped to the store. Anything unreadable simply
 * leaves the badge off: the list never fails because of this. `null` is the one
 * case worth telling apart: the store's customer records could not be read, so
 * "no badges" would be a guess (the Customers view must not read as "nobody").
 */
export async function loadCustomerBadges(input: {
  supabase: Db;
  merchantId: string;
  links: Record<number, string>;
  /** Order counts and spend are order data: only for callers with orders:view. */
  includeOrderData: boolean;
}): Promise<Record<number, MerchantInboxCustomerBadge> | null> {
  const entries = Object.entries(input.links);
  if (entries.length === 0) return {};
  const verify = await createChatCustomerLinkVerifier(input.merchantId);
  if (!verify) return {};

  const verified = await Promise.all(
    entries.map(async ([conversationId, token]) => ({
      conversationId: Number(conversationId),
      link: await verify(token),
    }))
  );
  const customerIds = [
    ...new Set(verified.flatMap((v) => (v.link ? [v.link.customerId] : []))),
  ];
  if (customerIds.length === 0) return {};

  // Without order access the order columns are not even read.
  const columns: string = input.includeOrderData
    ? 'id, total_orders, total_spent'
    : 'id';
  const { data, error } = await input.supabase
    .from('customers')
    .select(columns)
    .eq('merchant_id', input.merchantId)
    .in('id', customerIds)
    .is('deleted_at', null)
    .abortSignal(AbortSignal.timeout(BADGE_READ_TIMEOUT_MS));
  if (error || !data) return null;

  const rows = data as unknown as BadgeRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const badges: Record<number, MerchantInboxCustomerBadge> = {};
  for (const { conversationId, link } of verified) {
    const row = link ? byId.get(link.customerId) : undefined;
    if (!row) continue;
    badges[conversationId] = input.includeOrderData
      ? {
          orderCount: Math.trunc(toNumber(row.total_orders)),
          totalSpent: toNumber(row.total_spent),
        }
      : { orderCount: 0, totalSpent: 0, ordersHidden: true };
  }
  return badges;
}

const DEFAULT_CURRENCY = 'NGN';
const currencyCode = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim())
    ? value.trim().toUpperCase()
    : fallback;

/**
 * The card for one chat: who they are and what they have bought. Recent order
 * details are read only when `includeOrders` is true, which callers set from
 * the caller's own order permission (customer access alone is not enough).
 */
export async function loadCustomerProfile(input: {
  supabase: Db;
  merchantId: string;
  token: string;
  includeOrders: boolean;
}): Promise<MerchantInboxCustomerProfile | null> {
  const verify = await createChatCustomerLinkVerifier(input.merchantId);
  const link = verify ? await verify(input.token) : null;
  if (!link) return null;

  const profileColumns: string = input.includeOrders
    ? 'id, full_name, first_name, last_name, created_at, total_orders, total_spent, loyalty_points'
    : 'id, full_name, first_name, last_name';
  const { data, error } = await input.supabase
    .from('customers')
    .select(profileColumns)
    .eq('id', link.customerId)
    .eq('merchant_id', input.merchantId)
    .is('deleted_at', null)
    .maybeSingle();
  // A failed read is not "no such customer": say so instead of showing no card.
  if (error) throw new MerchantInboxCustomerUnavailableError();
  const customer = data as unknown as ProfileRow | null;
  if (!customer) return null;

  const [orders, merchantCurrency] = await Promise.all([
    input.includeOrders
      ? input.supabase
          .from('orders')
          .select(
            'order_number, total, currency, payment_status, shipping_status, created_at'
          )
          .eq('merchant_id', input.merchantId)
          .eq('customer_id', customer.id)
          .order('created_at', { ascending: false, nullsFirst: false })
          .limit(5)
          .then(({ data, error: ordersError }) => {
            // An unreadable order history must not read as "no orders yet".
            if (ordersError) throw new MerchantInboxCustomerUnavailableError();
            return data;
          })
      : Promise.resolve(null),
    loadChatwootMerchantCurrency(input.merchantId),
  ]);
  const storeCurrency = currencyCode(
    merchantCurrency?.currency,
    DEFAULT_CURRENCY
  );

  const name =
    customer.full_name?.trim() ||
    `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() ||
    'Customer';
  return {
    name: name.slice(0, 120),
    currency: storeCurrency,
    // Account age is customer data the order permission also covers.
    memberSince: (input.includeOrders && customer.created_at) || null,
    // Counts and spend are order data, gated like the order list itself.
    orderCount: input.includeOrders
      ? Math.trunc(toNumber(customer.total_orders))
      : 0,
    totalSpent: input.includeOrders ? toNumber(customer.total_spent) : 0,
    ...(input.includeOrders ? {} : { ordersHidden: true }),
    // Points come from purchases, so they follow the same gate.
    loyaltyPoints: input.includeOrders
      ? Math.trunc(toNumber(customer.loyalty_points))
      : 0,
    // An order with no number has nothing to show or look up, so it is left out
    // instead of appearing as the text "null".
    recentOrders: (orders ?? []).flatMap((order) => {
      const orderNumber = String(order.order_number ?? '')
        .trim()
        .slice(0, 60);
      if (!orderNumber) return [];
      return [
        {
          orderNumber,
          total: toNumber(order.total),
          currency: currencyCode(order.currency, storeCurrency),
          // A missing status reads as "unknown", never as the text "null".
          paymentStatus: String(order.payment_status ?? 'unknown').slice(0, 40),
          shippingStatus: String(order.shipping_status ?? 'unknown').slice(
            0,
            40
          ),
          createdAt: order.created_at,
        },
      ];
    }),
  };
}
