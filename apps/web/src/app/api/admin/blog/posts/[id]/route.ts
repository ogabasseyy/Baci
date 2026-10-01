import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import {
  deletePlatformBlogPost,
  getPlatformBlogPost,
} from './platform-blog-post-read-handlers';
import type { PlatformBlogRouteParams } from './platform-blog-post-route-schema';
import { updatePlatformBlogPost } from './platform-blog-post-update-handler';

function toAuthErrorResponse(status: 'unauthenticated' | 'forbidden') {
  return status === 'unauthenticated'
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function GET(
  _request: NextRequest,
  params: PlatformBlogRouteParams
) {
  const auth = await getPlatformAdminAuthForPermission('content.manage');
  if (auth.status !== 'authenticated') {
    return toAuthErrorResponse(auth.status);
  }

  return getPlatformBlogPost(params);
}

export async function PATCH(
  request: NextRequest,
  params: PlatformBlogRouteParams
) {
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

  return updatePlatformBlogPost(request, params);
}

export async function DELETE(
  request: NextRequest,
  params: PlatformBlogRouteParams
) {
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

  return deletePlatformBlogPost(params);
}
