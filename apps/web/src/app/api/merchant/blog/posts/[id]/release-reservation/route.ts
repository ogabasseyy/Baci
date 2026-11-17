import { type NextRequest, NextResponse } from 'next/server';
import { resolveSelectedMerchantAccess } from '@/app/api/merchant/features/resolve-selected-merchant-access';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { revalidateBlogPosts } from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import { getMerchantBlogRevalidationContext } from '@/lib/get-merchant-blog-cache-identifiers';
import {
  blogReleasePostParamsSchema,
  cancelBlogReleaseSchema,
  reserveBlogReleaseSchema,
} from '@/schemas/blog-release-reservation';
import { readRpcMutationError } from '../../persist-blog-post-mutation';
import type { RouteParams } from '../route-params';
import { buildReleaseReservationPayloadDigest } from './payload-digest';

async function authorizeMerchantBlogReleaseRequest(
  request: NextRequest,
  params: RouteParams['params']
): Promise<
  | { errorResponse: NextResponse }
  | {
      merchantId: string;
      postId: string;
      supabase: NonNullable<
        Awaited<ReturnType<typeof authenticateApiRequest>>['supabase']
      >;
    }
> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return {
      errorResponse: NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      ),
    };
  }
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return {
      errorResponse:
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 }),
    };
  }
  const parsedParams = blogReleasePostParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Invalid post ID' },
        { status: 400 }
      ),
    };
  }
  const selectedMerchant = await resolveSelectedMerchantAccess({
    requestedMerchantId: request.nextUrl.searchParams.get('merchantId'),
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (selectedMerchant.invalidMerchantId) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Invalid merchant ID' },
        { status: 400 }
      ),
    };
  }
  if (!selectedMerchant.access) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      ),
    };
  }
  if (!hasPermission(selectedMerchant.access, 'marketing', 'edit')) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      ),
    };
  }

  return {
    merchantId: selectedMerchant.access.merchantId,
    postId: parsedParams.data.id,
    supabase: auth.supabase,
  };
}

async function revalidateMerchantBlogCacheBestEffort(
  supabase: NonNullable<
    Awaited<ReturnType<typeof authenticateApiRequest>>['supabase']
  >,
  merchantId: string
) {
  try {
    const blogRevalidation = await getMerchantBlogRevalidationContext(
      supabase,
      merchantId
    );
    revalidateBlogPosts({
      merchantId,
      identifiers: blogRevalidation.identifiers,
      canonicalMerchantSlug: blogRevalidation.canonicalMerchantSlug,
    });
  } catch (error) {
    console.error('Failed post-reservation blog revalidation:', {
      merchantId,
      error,
    });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authorized = await authorizeMerchantBlogReleaseRequest(
      request,
      params
    );
    if ('errorResponse' in authorized) {
      return authorized.errorResponse;
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validated = reserveBlogReleaseSchema.safeParse(rawBody);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const payload = validated.data;
    const payloadDigest = buildReleaseReservationPayloadDigest(
      authorized.merchantId,
      authorized.postId,
      payload
    );

    const { data, error } = await authorized.supabase.rpc(
      'reserve_merchant_blog_release_v1',
      {
        p_merchant_id: authorized.merchantId,
        p_post_id: authorized.postId,
        p_article_identity: payload.article_identity,
        p_request_id: payload.request_id,
        p_payload_digest: payloadDigest,
        p_policy_version: payload.policy_version,
        p_release_class: payload.release_class,
        p_requested_publish_at: payload.requested_publish_at,
        p_task_type: payload.task_type ?? null,
        p_category: payload.category ?? null,
        p_is_low_demand_game_software: payload.is_low_demand_game_software,
        p_event_published_at: payload.event_published_at ?? null,
        ...(payload.daily_cap !== undefined
          ? { p_daily_cap: payload.daily_cap }
          : {}),
        ...(payload.fast_track_cap !== undefined
          ? { p_fast_track_cap: payload.fast_track_cap }
          : {}),
        ...(payload.evergreen_min_reserve !== undefined
          ? { p_evergreen_min_reserve: payload.evergreen_min_reserve }
          : {}),
        ...(payload.min_spacing_minutes !== undefined
          ? { p_min_spacing_minutes: payload.min_spacing_minutes }
          : {}),
        ...(payload.window_start_hour !== undefined
          ? { p_window_start_hour: payload.window_start_hour }
          : {}),
        ...(payload.window_end_hour !== undefined
          ? { p_window_end_hour: payload.window_end_hour }
          : {}),
      }
    );

    if (error || !data || typeof data !== 'object') {
      const mapped = readRpcMutationError(
        error,
        'Failed to reserve blog release slot'
      );
      return NextResponse.json(
        mapped.code
          ? { error: mapped.error, code: mapped.code }
          : { error: mapped.error },
        { status: mapped.status }
      );
    }

    await revalidateMerchantBlogCacheBestEffort(
      authorized.supabase,
      authorized.merchantId
    );

    const reservation = data as Record<string, unknown>;
    return NextResponse.json(reservation, {
      status: reservation.idempotent_replay === true ? 200 : 201,
    });
  } catch (error) {
    console.error('Reserve blog release error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authorized = await authorizeMerchantBlogReleaseRequest(
      request,
      params
    );
    if ('errorResponse' in authorized) {
      return authorized.errorResponse;
    }

    let rawBody: unknown = {};
    const rawText = await request.text();
    if (rawText.trim().length > 0) {
      try {
        rawBody = JSON.parse(rawText);
      } catch {
        return NextResponse.json(
          { error: 'Invalid JSON body' },
          { status: 400 }
        );
      }
    }

    const validated = cancelBlogReleaseSchema.safeParse(rawBody);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { data, error } = await authorized.supabase.rpc(
      'cancel_merchant_blog_release_v1',
      {
        p_merchant_id: authorized.merchantId,
        p_post_id: authorized.postId,
        p_reason: validated.data.reason ?? 'cancelled_via_api',
      }
    );

    if (error || !data || typeof data !== 'object') {
      const mapped = readRpcMutationError(
        error,
        'Failed to cancel blog release reservation'
      );
      return NextResponse.json(
        mapped.code
          ? { error: mapped.error, code: mapped.code }
          : { error: mapped.error },
        { status: mapped.status }
      );
    }

    await revalidateMerchantBlogCacheBestEffort(
      authorized.supabase,
      authorized.merchantId
    );

    return NextResponse.json(data);
  } catch (error) {
    console.error('Cancel blog release error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
