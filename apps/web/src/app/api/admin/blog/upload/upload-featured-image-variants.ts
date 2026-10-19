import type { NextResponse } from 'next/server';
import type {
  BlogFeaturedImageVariant,
  BlogFeaturedImageVariantsResult,
} from '@/lib/blog-featured-image-variants';
import type { createClient } from '@/lib/supabase/server';
import { releaseBlogMediaPaths } from './blog-media-tombstone-release';
import { stageUploadedBlogMediaPaths } from './blog-media-upload-stage';
import { buildPlatformMediaPath, toPlatformMediaUrl } from './upload-helpers';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type FeaturedImageVariantRecord = {
  contentType: string;
  height: number;
  path: string;
  url: string;
  width: number;
};

/**
 * Upload featured-image variants, staging each object before its
 * storage write. A terminated invocation then leaves every object
 * reclaimable via its tombstone instead of a permanent orphan the
 * cron can never see; a confirmed upload failure releases its
 * pre-staged tombstone and throws for the caller's cleanup. A
 * staging failure returns its response (nothing was written for
 * that variant, and the completed siblings stay swept-safe).
 */
export async function uploadFeaturedImageVariants(
  supabase: ServerSupabaseClient,
  fileToken: string,
  generated: BlogFeaturedImageVariantsResult,
  uploadedPaths: string[]
): Promise<
  | { response: NextResponse }
  | { variants: Record<string, FeaturedImageVariantRecord> }
> {
  const variants: Record<string, FeaturedImageVariantRecord> = {};
  const uploads: BlogFeaturedImageVariant[] = Object.values(
    generated.variants
  ).filter(
    (variant): variant is BlogFeaturedImageVariant => variant !== undefined
  );
  for (const variant of uploads) {
    const variantPath = buildPlatformMediaPath(
      `${fileToken}/${variant.key}.webp`
    );
    const variantStaging = await stageUploadedBlogMediaPaths(supabase, [
      variantPath,
    ]);
    if (variantStaging) return { response: variantStaging };
    const { error: variantError } = await supabase.storage
      .from('media')
      .upload(variantPath, variant.buffer, {
        cacheControl: '31536000',
        contentType: variant.contentType,
        upsert: false,
      });

    if (variantError) {
      await releaseBlogMediaPaths(supabase, [variantPath]);
      throw variantError;
    }

    uploadedPaths.push(variantPath);
    variants[variant.key] = {
      contentType: variant.contentType,
      height: variant.height,
      path: variantPath,
      url: toPlatformMediaUrl(variantPath),
      width: variant.width,
    };
  }
  return { variants };
}
