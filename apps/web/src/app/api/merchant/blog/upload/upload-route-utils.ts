import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasPermission, type UserAccess } from '@/lib/api-auth';
import type { BlogFeaturedImageError } from '@/lib/blog-featured-image-variants';
import { buildBlogMediaCdnUrl } from '@/lib/blog-managed-storage-paths';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';

const uploadPurposeSchema = z.enum(['featured', 'inline']);
const requestedMerchantIdSchema = z.uuid();

const variantPathObjectSchema = z.object({
  square_1x1: z.string().min(1).optional(),
  standard_4x3: z.string().min(1).optional(),
  landscape_16x9: z.string().min(1).optional(),
});

export const deleteBodySchema = z
  .object({
    path: z.string().min(1).optional(),
    variantPaths: z
      .union([z.array(z.string().min(1)).max(99), variantPathObjectSchema])
      .optional(),
  })
  .refine(
    (value) =>
      value.path ||
      (Array.isArray(value.variantPaths)
        ? value.variantPaths.length > 0
        : Object.values(value.variantPaths ?? {}).length > 0),
    { error: 'No path provided' }
  );

export const MAX_FILE_SIZE = 5 * 1024 * 1024;

type MediaStorageCleanupClient = {
  storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<{ error: unknown | null }>;
    };
  };
};

const inlineAllowedTypes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
];
const featuredAllowedTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
];

export const mimeToExt: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

type UploadPurpose = z.infer<typeof uploadPurposeSchema>;

export function resolveUploadPurpose(
  value: FormDataEntryValue | null
): UploadPurpose {
  if (typeof value !== 'string') return 'inline';
  const parsed = uploadPurposeSchema.safeParse(value.toLowerCase().trim());
  return parsed.success ? parsed.data : 'inline';
}

export function getAllowedTypesForPurpose(purpose: UploadPurpose): string[] {
  return purpose === 'featured' ? featuredAllowedTypes : inlineAllowedTypes;
}

export async function resolveMerchantAccess(input: {
  headers: Headers;
  supabase: SupabaseClient;
  userId: string;
}): Promise<{ access: UserAccess | null; response: NextResponse | null }> {
  const requestedMerchantId = input.headers.get('x-baci-merchant-id');
  const parsedMerchantId = requestedMerchantId
    ? requestedMerchantIdSchema.safeParse(requestedMerchantId)
    : null;
  if (requestedMerchantId && !parsedMerchantId?.success) {
    return {
      access: null,
      response: NextResponse.json(
        { error: 'Invalid merchant context' },
        { status: 400 }
      ),
    };
  }

  const merchantContext = await getMerchantForApiRequest(
    input.supabase,
    input.userId,
    { requestedMerchantId: parsedMerchantId?.data ?? null }
  );
  if (!merchantContext) {
    return {
      access: null,
      response: NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      ),
    };
  }

  const access = toUserAccess(merchantContext);
  if (!hasPermission(access, 'marketing', 'edit')) {
    return {
      access: null,
      response: NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      ),
    };
  }
  return { access, response: null };
}

export async function cleanupUploadedPaths(
  supabase: MediaStorageCleanupClient,
  uploadedPaths: string[]
) {
  if (uploadedPaths.length === 0) return;
  try {
    const { error } = await supabase.storage
      .from('media')
      .remove(uploadedPaths);
    if (!error) return;
    console.error('Failed to clean up partially uploaded blog media paths', {
      error,
      uploadedPaths,
    });
  } catch (error) {
    console.error('Failed to clean up partially uploaded blog media paths', {
      error,
      uploadedPaths,
    });
  }
}

export function toFeaturedUploadErrorResponse(error: BlogFeaturedImageError) {
  const status = error.code === 'FEATURED_IMAGE_PROCESSING_FAILED' ? 500 : 400;
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status }
  );
}

export function getCanonicalBlogMediaUrl(path: string, merchantId: string) {
  const url = buildBlogMediaCdnUrl(path, merchantId);
  if (!url) {
    console.error(
      'buildBlogMediaCdnUrl could not construct a blog media CDN URL',
      { path, merchantId }
    );
    throw new Error(
      `Failed to build blog media CDN URL for merchantId="${merchantId}" path="${path}"`
    );
  }
  return url;
}
