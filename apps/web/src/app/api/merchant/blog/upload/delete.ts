import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { isManagedBlogStoragePath } from '@/lib/blog-featured-image-variants';
import { checkCsrfProtection } from '@/lib/csrf';
import { deleteMerchantMedia } from '@/lib/media/delete-merchant-media';
import { checkRateLimit } from '@/lib/rate-limiter';
import { deleteBodySchema, resolveMerchantAccess } from './upload-route-utils';

export async function DELETE(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  const merchantAccess = await resolveMerchantAccess({
    headers: request.headers,
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (merchantAccess.response || !merchantAccess.access) {
    return (
      merchantAccess.response ??
      NextResponse.json({ error: 'Merchant not found' }, { status: 404 })
    );
  }
  const access = merchantAccess.access;

  try {
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    }
    const parsed = deleteBodySchema.safeParse(requestBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'No path provided' }, { status: 400 });
    }
    const isAllowed = await checkRateLimit(
      auth.supabase,
      auth.user.id,
      'merchant_blog_upload',
      5,
      1
    );
    if (!isAllowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'rate_limited' },
        { status: 429 }
      );
    }
    const variantPaths = Array.isArray(parsed.data.variantPaths)
      ? parsed.data.variantPaths
      : Object.values(parsed.data.variantPaths ?? {});
    const inputPaths = [parsed.data.path, ...variantPaths]
      .filter((path): path is string => typeof path === 'string')
      .map((path) => path.trim())
      .filter(Boolean);
    const dedupedPaths: string[] = [];
    const pathSet = new Set<string>();
    for (const path of inputPaths) {
      if (!isManagedBlogStoragePath(path, access.merchantId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      if (!pathSet.has(path)) {
        pathSet.add(path);
        dedupedPaths.push(path);
      }
    }
    if (dedupedPaths.length === 0) {
      return NextResponse.json({ error: 'No path provided' }, { status: 400 });
    }
    const failure = await deleteMerchantMedia({
      client: auth.supabase,
      merchantId: access.merchantId,
      identities: dedupedPaths,
    });
    if (failure)
      return NextResponse.json(failure.body, { status: failure.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting blog image:', error);
    return NextResponse.json(
      { error: 'Failed to delete image' },
      { status: 500 }
    );
  }
}
