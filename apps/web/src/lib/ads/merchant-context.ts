import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { UserAccess } from '@/lib/api-auth';
import { getUserAccess } from '@/lib/api-auth';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { requestedMerchantIdSchema } from '@/schemas/branches';

type MerchantContextSource = 'header' | 'query';

export async function resolveAdsMerchantAccess({
  merchantId: requestedMerchantId,
  request,
  source = 'header',
  supabase,
  userId,
}: {
  merchantId?: string;
  request: Request;
  source?: MerchantContextSource;
  supabase: SupabaseClient;
  userId: string;
}): Promise<{ access: UserAccess | null; response: NextResponse | null }> {
  const rawMerchantId =
    requestedMerchantId ??
    (source === 'header'
      ? request.headers.get('x-baci-merchant-id')
      : new URL(request.url).searchParams.get('merchantId'));
  if (!rawMerchantId) {
    return { access: await getUserAccess(supabase), response: null };
  }
  const merchantId = requestedMerchantIdSchema.safeParse(rawMerchantId.trim());
  if (!merchantId.success) {
    return {
      access: null,
      response: NextResponse.json(
        { error: 'Invalid merchant context' },
        { status: 400 }
      ),
    };
  }
  const context = await getMerchantForApiRequest(supabase, userId, {
    requestedMerchantId: merchantId.data,
  });
  return { access: context ? toUserAccess(context) : null, response: null };
}
