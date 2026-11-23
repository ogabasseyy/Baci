import 'server-only';

import type { MerchantInboxConversation } from '@/schemas/merchant-inbox';
import {
  listMerchantInboxConversations,
  type MerchantInboxFailure,
} from './merchant-inbox-client';
import type { MerchantInboxBinding } from './merchant-inbox-config';
import { loadCustomerBadges } from './merchant-inbox-customer';
import type { resolveMerchantInboxRequest } from './merchant-inbox-request';
import type { MerchantInboxView } from './merchant-inbox-views';

type Db = Extract<
  Awaited<ReturnType<typeof resolveMerchantInboxRequest>>,
  { ok: true }
>['supabase'];

/**
 * The Customers view keeps only returning customers, which is known after the
 * engine's page is read. A page can hold none, so up to this many engine pages
 * are read for one request; after that the answer is empty with `hasMore`, and
 * the app (which loads a few pages by itself, then offers "Look further back")
 * carries on from the page reached.
 */
const RETURNING_MAX_PROVIDER_PAGES = 4;

type Input = {
  binding: MerchantInboxBinding;
  supabase: Db;
  merchantId: string;
  /** May the caller see order data (counts, spend, orders)? */
  canViewOrders: boolean;
  page: number;
  status: 'open' | 'resolved' | 'pending' | 'snoozed' | 'all';
  view?: MerchantInboxView;
};

type Listed =
  | {
      ok: true;
      conversations: MerchantInboxConversation[];
      hasMore: boolean;
      /** The last engine page read: the next request starts after it. */
      page: number;
    }
  | MerchantInboxFailure;

const isReturning = (c: MerchantInboxConversation) =>
  (c.customer?.orderCount ?? 0) > 0;

/**
 * One page of the inbox with each linked, signed-in customer's badge attached.
 * Badges are best-effort and never fail the list.
 */
export async function listConversationsWithCustomers(
  input: Input
): Promise<Listed> {
  const readPage = async (page: number) => {
    const result = await listMerchantInboxConversations(input.binding, {
      page,
      status: input.status,
      view: input.view,
    });
    if (!result.ok) return result;
    const loaded = await loadCustomerBadges({
      supabase: input.supabase,
      merchantId: input.merchantId,
      links: result.links,
      includeOrderData: input.canViewOrders,
    });
    // `null`: the customer records could not be read. An ordinary list just goes
    // without badges, but the Customers view is made of them, so for it an
    // outage must not read as "no returning customers".
    if (loaded === null && input.view === 'returning') {
      return { ok: false as const, code: 'unavailable' as const };
    }
    const badges = loaded ?? {};
    const conversations = result.conversations.map((conversation) =>
      badges[conversation.id]
        ? { ...conversation, customer: badges[conversation.id] }
        : conversation
    );
    return { ok: true as const, conversations, hasMore: result.hasMore };
  };

  if (input.view !== 'returning') {
    const result = await readPage(input.page);
    return result.ok ? { ...result, page: input.page } : result;
  }

  // Returning customers are defined by their orders: without order access
  // there is nothing to list, and nothing is read.
  if (!input.canViewOrders) {
    return { ok: true, conversations: [], hasMore: false, page: input.page };
  }

  const found: MerchantInboxConversation[] = [];
  let page = input.page;
  let hasMore = true;
  for (let read = 0; read < RETURNING_MAX_PROVIDER_PAGES; read++) {
    const result = await readPage(page);
    // Any failed read is a failure, never an empty "success": an outage must
    // not look like "no returning customers here". (Rows found so far return
    // before the loop continues, so no found rows are lost by this.)
    if (!result.ok) return result;
    found.push(...result.conversations.filter(isReturning));
    hasMore = result.hasMore;
    if (found.length > 0 || !hasMore) {
      return { ok: true, conversations: found, hasMore, page };
    }
    page++;
  }
  return { ok: true, conversations: found, hasMore, page: page - 1 };
}
