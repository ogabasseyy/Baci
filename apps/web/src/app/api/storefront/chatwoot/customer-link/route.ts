import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { issueChatCustomerLinkToken } from '@/lib/chatwoot/chat-customer-link-token';
import { getChatwootTenantBinding } from '@/lib/chatwoot/commerce-context-config';
import { checkCsrfProtection } from '@/lib/csrf';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { chatCustomerLinkRequestSchema } from '@/schemas/chat-customer-link';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };
/** The body is one store slug. */
const MAX_BODY_BYTES = 1024;

function reply(status: number, code: string) {
  return NextResponse.json(
    { error: 'Chat link unavailable', code },
    { status, headers: NO_STORE_HEADERS }
  );
}

/**
 * Gives a signed-in shopper a signed "this is customer X of store Y" note for
 * the store chat, so the store owner can see their order history next to the
 * conversation. Guests get 401 and nothing changes for them.
 */
export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return csrf.response ?? reply(403, 'forbidden');

  // Authenticate before reading input: a guest learns nothing about it.
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return reply(401, 'unauthorized');
  }

  const rawBody = await readBoundedJsonBody(request, MAX_BODY_BYTES);
  const body = chatCustomerLinkRequestSchema.safeParse(
    rawBody.ok ? rawBody.body : null
  );
  if (!body.success) return reply(400, 'invalid_request');

  const { data: merchant, error: merchantError } = await auth.supabase
    .from('merchants')
    .select('id')
    .eq('slug', body.data.storeSlug)
    .maybeSingle();
  if (merchantError || !merchant) return reply(404, 'not_found');

  // Only stores whose chat is set up get a link.
  try {
    getChatwootTenantBinding(merchant.id);
  } catch {
    return reply(404, 'not_found');
  }

  // The shopper's own customer record for this store: another store's
  // customer id can never be put on this store's chat.
  const { data: customer, error: customerError } = await auth.supabase
    .from('customers')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('merchant_id', merchant.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (customerError) return reply(503, 'temporarily_unavailable');
  if (!customer) return reply(404, 'not_found');

  const token = await issueChatCustomerLinkToken({
    merchantId: merchant.id,
    customerId: customer.id,
  });
  if (!token) return reply(503, 'temporarily_unavailable');

  return NextResponse.json({ token }, { headers: NO_STORE_HEADERS });
}
