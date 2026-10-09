import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { createClient } from '@/lib/supabase/server';
import { refreshBlogMediaTombstones } from './blog-media-tombstone-refresh';
import {
  parseDeleteBodyFromRequest,
  toAuthErrorResponse,
} from './upload-helpers';

const PLATFORM_BLOG_MEDIA_REFRESH_RATE_LIMIT = 30;
const PLATFORM_BLOG_MEDIA_REFRESH_RATE_WINDOW_MINUTES = 1;

/**
 * Handle the upload route's PATCH: extend the sweep grace window
 * for staged paths an open draft still references. Shares the
 * DELETE guards (platform content.manage auth, CSRF, per-user rate
 * limit, platform-scoped path validation) since a lease refresh is
 * a write against the same tombstone rows.
 */
export async function handleBlogMediaTombstoneRefresh(
  request: NextRequest
): Promise<NextResponse> {
  const auth = await getPlatformAdminAuthForPermission('content.manage');
  if (auth.status !== 'authenticated') {
    return toAuthErrorResponse(auth.status);
  }

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  const supabase = await createClient();
  const isAllowed = await checkRateLimit(
    supabase,
    auth.user.id,
    'platform_blog_media_refresh',
    PLATFORM_BLOG_MEDIA_REFRESH_RATE_LIMIT,
    PLATFORM_BLOG_MEDIA_REFRESH_RATE_WINDOW_MINUTES
  );
  if (!isAllowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited' },
      { status: 429 }
    );
  }

  const parsed = await parseDeleteBodyFromRequest(request);
  if (parsed.response) {
    return parsed.response;
  }

  const refreshed = await refreshBlogMediaTombstones(supabase, parsed.paths);
  if (!refreshed) {
    console.error('Platform blog media tombstone refresh failed', {
      paths: parsed.paths,
    });
    return NextResponse.json(
      { error: 'Failed to refresh media lease' },
      { status: 500 }
    );
  }
  return NextResponse.json({ refreshed: parsed.paths, success: true });
}
