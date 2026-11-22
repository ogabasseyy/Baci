import 'server-only';

import type {
  MerchantInboxCustomerBadge,
  MerchantInboxCustomerProfile,
} from '@/schemas/merchant-inbox-customer';
import { createChatCustomerLinkVerifier } from './chat-customer-link-token';
import type { resolveMerchantInboxRequest } from './merchant-inbox-request';

type Resolved = Extract<
  Awaited<ReturnType<typeof resolveMerchantInboxRequest>>,
  { ok: true }
>;
type Db = Resolved['supabase'];

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Order count and spend for the customers behind a page of chats. Only a link
 * the server signed for this store counts, and the customer row is read under
 * the caller's own access, scoped to the store. Anything unreadable simply
 * leaves the badge off: the list never fails because of this.
 */
export async function loadCustomerBadges(input: {
  supabase: Db;
  merchantId: string;
  links: Record<number, string>;
}): Promise<Record<number, MerchantInboxCustomerBadge>> {
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

  const { data, error } = await input.supabase
    .from('customers')
    .select('id, total_orders, total_spent')
    .eq('merchant_id', input.merchantId)
    .in('id', customerIds)
    .is('deleted_at', null);
  if (error || !data) return {};

  const byId = new Map(data.map((row) => [row.id, row]));
  const badges: Record<number, MerchantInboxCustomerBadge> = {};
  for (const { conversationId, link } of verified) {
    const row = link ? byId.get(link.customerId) : undefined;
    if (!row) continue;
    badges[conversationId] = {
      orderCount: Math.trunc(toNumber(row.total_orders)),
      totalSpent: toNumber(row.total_spent),
    };
  }
  return badges;
}

/** The card for one chat: who they are and what they have bought. */
export async function loadCustomerProfile(input: {
  supabase: Db;
  merchantId: string;
  token: string;
}): Promise<MerchantInboxCustomerProfile | null> {
  const verify = await createChatCustomerLinkVerifier(input.merchantId);
  const link = verify ? await verify(input.token) : null;
  if (!link) return null;

  const { data: customer, error } = await input.supabase
    .from('customers')
    .select(
      'id, full_name, first_name, last_name, created_at, total_orders, total_spent, loyalty_points'
    )
    .eq('id', link.customerId)
    .eq('merchant_id', input.merchantId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !customer) return null;

  const { data: orders } = await input.supabase
    .from('orders')
    .select('order_number, total, payment_status, shipping_status, created_at')
    .eq('merchant_id', input.merchantId)
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(5);

  const name =
    customer.full_name?.trim() ||
    `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() ||
    'Customer';
  return {
    name: name.slice(0, 120),
    memberSince: customer.created_at,
    orderCount: Math.trunc(toNumber(customer.total_orders)),
    totalSpent: toNumber(customer.total_spent),
    loyaltyPoints: Math.trunc(toNumber(customer.loyalty_points)),
    recentOrders: (orders ?? []).map((order) => ({
      orderNumber: String(order.order_number).slice(0, 60),
      total: toNumber(order.total),
      paymentStatus: String(order.payment_status).slice(0, 40),
      shippingStatus: String(order.shipping_status).slice(0, 40),
      createdAt: order.created_at,
    })),
  };
}
