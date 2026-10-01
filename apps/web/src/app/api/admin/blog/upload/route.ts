import { nanoid } from 'nanoid';
import { type NextRequest, NextResponse } from 'next/server';
import {
  BlogFeaturedImageError,
  generateFeaturedImageVariants,
} from '@/lib/blog-featured-image-variants';
import { revalidatePlatformBlog } from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { createClient } from '@/lib/supabase/server';
import {
  buildPlatformMediaPath,
  cleanupUploadedPaths,
  getAllowedTypesForPurpose,
  MAX_FILE_SIZE,
  MIME_TO_EXTENSION,
  parseDeleteBodyFromRequest,
  resolveUploadPurpose,
  toAuthErrorResponse,
  toFeaturedUploadErrorResponse,
  toPlatformMediaUrl,
} from './upload-helpers';

const PLATFORM_BLOG_UPLOAD_RATE_LIMIT = 30;
const PLATFORM_BLOG_UPLOAD_RATE_WINDOW_MINUTES = 1;

export async function POST(request: NextRequest) {
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
    'platform_blog_upload',
    PLATFORM_BLOG_UPLOAD_RATE_LIMIT,
    PLATFORM_BLOG_UPLOAD_RATE_WINDOW_MINUTES
  );
  if (!isAllowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited' },
      { status: 429 }
    );
  }

  const formData = await request.formData();
  const entry = formData.get('file');
  if (!entry || !(entry instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const file = entry;
  const purpose = resolveUploadPurpose(formData.get('purpose'));
  const allowedTypes = getAllowedTypesForPurpose(purpose);
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      {
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      },
      { status: 400 }
    );
  }

  const extension = MIME_TO_EXTENSION[file.type] || 'jpg';
  const fileToken = nanoid(12);
  const filePath = buildPlatformMediaPath(`${fileToken}.${extension}`);
  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const uploadedPaths: string[] = [];

  const { error: uploadError } = await supabase.storage
    .from('media')
    .upload(filePath, sourceBuffer, {
      cacheControl: '31536000',
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error('Platform blog media upload failed', { error: uploadError });
    return NextResponse.json(
      { error: 'Failed to upload file', code: 'UPLOAD_FAILED' },
      { status: 500 }
    );
  }

  uploadedPaths.push(filePath);

  if (purpose === 'inline') {
    revalidatePlatformBlog();
    return NextResponse.json({
      filename: `${fileToken}.${extension}`,
      path: filePath,
      size: file.size,
      type: file.type,
      url: toPlatformMediaUrl(filePath),
    });
  }

  let generated: Awaited<ReturnType<typeof generateFeaturedImageVariants>>;
  try {
    generated = await generateFeaturedImageVariants(sourceBuffer, {
      mimeType: file.type,
    });
  } catch (error) {
    await cleanupUploadedPaths(supabase, uploadedPaths);
    if (error instanceof BlogFeaturedImageError) {
      return toFeaturedUploadErrorResponse(error);
    }
    throw error;
  }

  const featuredImageVariants: Record<
    string,
    {
      contentType: string;
      height: number;
      path: string;
      url: string;
      width: number;
    }
  > = {};

  try {
    for (const variant of Object.values(generated.variants)) {
      const variantPath = buildPlatformMediaPath(
        `${fileToken}/${variant.key}.webp`
      );
      const { error: variantError } = await supabase.storage
        .from('media')
        .upload(variantPath, variant.buffer, {
          cacheControl: '31536000',
          contentType: variant.contentType,
          upsert: false,
        });

      if (variantError) {
        throw variantError;
      }

      uploadedPaths.push(variantPath);
      featuredImageVariants[variant.key] = {
        contentType: variant.contentType,
        height: variant.height,
        path: variantPath,
        url: toPlatformMediaUrl(variantPath),
        width: variant.width,
      };
    }
  } catch (error) {
    await cleanupUploadedPaths(supabase, uploadedPaths);
    console.error(
      'Platform featured variant upload failed; cleaned partial uploads',
      {
        error,
        uploadedPaths,
      }
    );
    return NextResponse.json(
      { error: 'Failed to upload file', code: 'UPLOAD_FAILED' },
      { status: 500 }
    );
  }

  revalidatePlatformBlog();

  return NextResponse.json({
    featuredImageVariants,
    filename: `${fileToken}.${extension}`,
    height: generated.source.height,
    path: filePath,
    size: file.size,
    type: file.type,
    url: toPlatformMediaUrl(filePath),
    variantPaths: Object.fromEntries(
      Object.entries(featuredImageVariants).map(([key, value]) => [
        key,
        value.path,
      ])
    ),
    variants: Object.fromEntries(
      Object.entries(featuredImageVariants).map(([key, value]) => [
        key,
        value.url,
      ])
    ),
    width: generated.source.width,
  });
}

export async function DELETE(request: NextRequest) {
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
    'platform_blog_upload',
    PLATFORM_BLOG_UPLOAD_RATE_LIMIT,
    PLATFORM_BLOG_UPLOAD_RATE_WINDOW_MINUTES
  );
  if (!isAllowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited' },
      { status: 429 }
    );
  }

  const parsedDeleteBody = await parseDeleteBodyFromRequest(request);
  if (parsedDeleteBody.response) {
    return parsedDeleteBody.response;
  }

  const { error } = await supabase.storage
    .from('media')
    .remove(parsedDeleteBody.paths);
  if (error) {
    console.error('Platform blog media delete failed', {
      error,
      paths: parsedDeleteBody.paths,
    });
    return NextResponse.json(
      { error: 'Failed to delete file' },
      { status: 500 }
    );
  }

  revalidatePlatformBlog();
  return NextResponse.json({ success: true });
}
