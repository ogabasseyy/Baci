import type { NextRequest } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { requireExperienceOwner } from '@/lib/experience/authorization';
import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import {
  experiencePreviewInput,
  experiencePreviewStatusInput,
} from '@/schemas/experience-preview';

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};
export async function GET(request?: NextRequest) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw Error('UNAUTHORIZED');
    const parsed = experiencePreviewStatusInput.safeParse(
      request ? Object.fromEntries(request.nextUrl.searchParams) : {}
    );
    if (!parsed.success)
      return Response.json(
        { error: 'Use an authenticated POST to launch.' },
        { status: 405, headers }
      );

    const merchant = await getMerchantForApiRequest(supabase, data.user.id, {
      requestedMerchantId: parsed.data.merchantId,
    });
    if (
      !merchant?.staffAccess.isOwner ||
      merchant.merchantId !== parsed.data.merchantId
    )
      throw Error('FORBIDDEN');
    const ctx = await requireExperienceOwner({
      supabase,
      merchantId: merchant.merchantId,
    });
    const owned = await ctx.supabase
      .from('experience_preview_bindings')
      .select('id')
      .eq('merchant_id', ctx.merchantId)
      .eq('id', parsed.data.bindingId)
      .maybeSingle();
    if (owned.error || !owned.data) throw Error('NOT_FOUND');
    const active = await ctx.supabase.rpc('experience_preview_binding_active', {
      p_binding: parsed.data.bindingId,
    });
    return Response.json(
      { active: !active.error && active.data === true },
      { headers }
    );
  } catch {
    return Response.json({ active: false }, { status: 403, headers });
  }
}
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user)
    return Response.json(
      { error: 'Sign in to preview.' },
      { status: 401, headers }
    );
  const runtime = getExperienceOwnerRuntime();
  if (!runtime)
    return Response.json(
      { error: 'Private preview is not installed.' },
      { status: 503, headers }
    );
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  const body = await readBoundedJsonBody(request, 4096);
  const parsed = body.ok ? experiencePreviewInput.safeParse(body.body) : null;
  if (!parsed?.success)
    return Response.json(
      { error: 'Invalid preview request.' },
      { status: 400, headers }
    );
  try {
    const merchant = await getMerchantForApiRequest(supabase, data.user.id, {
      requestedMerchantId: parsed.data.merchantId,
    });
    if (
      !merchant?.staffAccess.isOwner ||
      merchant.merchantId !== parsed.data.merchantId
    )
      throw Error('FORBIDDEN');
    return Response.json(
      await runtime.createPreviewLaunch(
        {
          supabase,
          merchantId: merchant.merchantId,
          requestOrigin: request.nextUrl.origin,
        },
        parsed.data
      ),
      { headers }
    );
  } catch {
    return Response.json(
      { error: 'Preview unavailable.' },
      { status: 403, headers }
    );
  }
}
