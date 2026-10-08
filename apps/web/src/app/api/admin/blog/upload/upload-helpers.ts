import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { BlogFeaturedImageError } from '@/lib/blog-featured-image-variants';
import type { createClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

import {
  buildBlogMediaCdnUrl,
  isManagedBlogStoragePath,
  PLATFORM_BLOG_MEDIA_PREFIX,
} from '@/lib/blog-managed-storage-paths';

const PLATFORM_STORAGE_SCOPE = { kind: 'platform' } as const;
// Keep featured originals within OG loader limits to avoid publish-time preview drift.
export const MAX_FILE_SIZE = 4 * 1024 * 1024;

const INLINE_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
];

export const FEATURED_ALLOWED_TYPES = ['image/jpeg', 'image/png'];

export const MIME_TO_EXTENSION: Record<string, string> = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const uploadPurposeSchema = z.enum(['featured', 'inline']);
const variantPathObjectSchema = z.object({
  landscape_16x9: z.string().min(1).optional(),
  square_1x1: z.string().min(1).optional(),
  standard_4x3: z.string().min(1).optional(),
});

const deleteBodySchema = z
  .object({
    path: z.string().min(1).optional(),
    variantPaths: z
      .union([z.array(z.string().min(1)), variantPathObjectSchema])
      .optional(),
  })
  .refine(
    (value) =>
      value.path ||
      (Array.isArray(value.variantPaths)
        ? value.variantPaths.length > 0
        : Object.values(value.variantPaths ?? {}).length > 0),
    {
      error: 'No path provided',
    }
  );

export function toAuthErrorResponse(status: 'unauthenticated' | 'forbidden') {
  return status === 'unauthenticated'
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export function getAllowedTypesForPurpose(
  purpose: z.infer<typeof uploadPurposeSchema>
) {
  return purpose === 'featured' ? FEATURED_ALLOWED_TYPES : INLINE_ALLOWED_TYPES;
}

export function resolveUploadPurpose(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') {
    return 'inline' as const;
  }

  const parsed = uploadPurposeSchema.safeParse(value.toLowerCase().trim());
  return parsed.success ? parsed.data : 'inline';
}

export function buildPlatformMediaPath(pathSuffix: string): string {
  return `${PLATFORM_BLOG_MEDIA_PREFIX}/${pathSuffix}`;
}

export function toPlatformMediaUrl(path: string): string {
  const url = buildBlogMediaCdnUrl(path, PLATFORM_STORAGE_SCOPE);
  if (!url) {
    throw new Error(
      `Failed to build platform blog media URL for path "${path}"`
    );
  }
  return url;
}

type UploadCleanupClient = {
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => Promise<{ error: unknown }>;
    };
  };
};

export async function cleanupUploadedPaths(
  supabase: UploadCleanupClient,
  uploadedPaths: string[]
) {
  if (uploadedPaths.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from('media').remove(uploadedPaths);
  if (error) {
    console.error(
      'Failed to clean up partially uploaded platform blog media paths',
      {
        error,
        uploadedPaths,
      }
    );
  }
}

export function toFeaturedUploadErrorResponse(error: BlogFeaturedImageError) {
  const status = error.code === 'FEATURED_IMAGE_PROCESSING_FAILED' ? 500 : 400;
  return NextResponse.json(
    { code: error.code, error: error.message },
    { status }
  );
}

export function parseDeleteRequestBody(
  requestBody: unknown
):
  | { paths: string[]; response: null }
  | { paths: null; response: NextResponse } {
  const parsed = deleteBodySchema.safeParse(requestBody);
  if (!parsed.success) {
    return {
      paths: null,
      response: NextResponse.json(
        { error: 'No path provided' },
        { status: 400 }
      ),
    };
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
    if (!isManagedBlogStoragePath(path, PLATFORM_STORAGE_SCOPE)) {
      return {
        paths: null,
        response: NextResponse.json(
          { error: 'Access denied' },
          { status: 403 }
        ),
      };
    }

    if (!pathSet.has(path)) {
      pathSet.add(path);
      dedupedPaths.push(path);
    }
  }

  if (dedupedPaths.length === 0) {
    return {
      paths: null,
      response: NextResponse.json(
        { error: 'No path provided' },
        { status: 400 }
      ),
    };
  }

  return { paths: dedupedPaths, response: null };
}

export async function parseDeleteBodyFromRequest(request: NextRequest) {
  try {
    const requestBody = await request.json();
    return parseDeleteRequestBody(requestBody);
  } catch {
    return {
      paths: null,
      response: NextResponse.json({ error: 'Malformed JSON' }, { status: 400 }),
    };
  }
}

export type BlogPostMediaRow = {
  content?: string | null;
  excerpt?: string | null;
  featured_image_url?: string | null;
  featured_image_variants?: unknown;
  author_image_url?: string | null;
};

/**
 * Whether a persisted platform post embeds a storage path. Variant maps
 * serialize before matching; every other media-carrying column compares
 * directly, since stored URLs always contain the raw storage path.
 */
export function blogPostRowReferencesPath(
  row: BlogPostMediaRow,
  path: string
): boolean {
  const fields: unknown[] = [
    row.content,
    row.excerpt,
    row.featured_image_url,
    row.author_image_url,
  ];
  if (typeof row.featured_image_variants === 'string') {
    fields.push(row.featured_image_variants);
  } else if (row.featured_image_variants) {
    fields.push(JSON.stringify(row.featured_image_variants));
  }
  return fields.some(
    (field) => typeof field === 'string' && field.includes(path)
  );
}

const BLOG_MEDIA_REFERENCE_SCAN_LIMIT = 5000;

/**
 * Split candidate delete paths by persisted references. A session that
 * abandons an upload cannot know another tab already saved its URL, so
 * deletion stays conditional on no persisted platform post referencing
 * each path. Returns null when the reference scan itself fails so the
 * route fails closed instead of deleting blind.
 */
export async function filterBlogMediaPathsWithoutPersistedReferences(
  supabase: ServerSupabaseClient,
  paths: string[]
): Promise<{ deletable: string[]; skipped: string[] } | null> {
  let references: {
    data: BlogPostMediaRow[] | null;
    error: { message: string } | null;
  };
  try {
    references = await supabase
      .from('blog_posts')
      .select(
        'content, excerpt, featured_image_url, featured_image_variants, author_image_url'
      )
      .eq('is_platform_post', true)
      .is('merchant_id', null)
      .limit(BLOG_MEDIA_REFERENCE_SCAN_LIMIT);
  } catch {
    return null;
  }
  if (references.error) return null;
  const rows = references.data ?? [];
  return {
    deletable: paths.filter(
      (path) => !rows.some((row) => blogPostRowReferencesPath(row, path))
    ),
    skipped: paths.filter((path) =>
      rows.some((row) => blogPostRowReferencesPath(row, path))
    ),
  };
}
