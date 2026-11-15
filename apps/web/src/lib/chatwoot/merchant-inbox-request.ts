import 'server-only';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import {
  getMerchantInboxBinding,
  type MerchantInboxBinding,
} from './merchant-inbox-config';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export function merchantInboxError(
  status: number,
  error: string,
  code: string
): NextResponse {
  return NextResponse.json(
    { error, code },
    { status, headers: NO_STORE_HEADERS }
  );
}

export function merchantInboxJson(body: unknown): NextResponse {
  return NextResponse.json(body, { headers: NO_STORE_HEADERS });
}

/**
 * Authenticates the caller, resolves their merchant (owner or staff) and
 * returns that merchant's inbox binding. The merchant is never chosen by the
 * request: only the signed-in session selects it.
 */
export async function resolveMerchantInboxRequest(
  action: 'view' | 'edit'
): Promise<
  | { ok: true; binding: MerchantInboxBinding }
  | { ok: false; response: NextResponse }
> {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: merchantInboxError(401, 'Unauthorized', 'unauthorized'),
    };
  }

  const merchantContext = await getMerchantForApiRequest(supabase, user.id);
  if (!merchantContext) {
    return {
      ok: false,
      response: merchantInboxError(
        404,
        'Merchant not found',
        'merchant_not_found'
      ),
    };
  }
  if (!hasPermission(toUserAccess(merchantContext), 'customers', action)) {
    return {
      ok: false,
      response: merchantInboxError(403, 'Forbidden', 'forbidden'),
    };
  }

  const binding = getMerchantInboxBinding(merchantContext.merchantId);
  if (!binding) {
    return {
      ok: false,
      response: merchantInboxError(
        404,
        'Messages are not set up for this store',
        'inbox_unavailable'
      ),
    };
  }
  return { ok: true, binding };
}
