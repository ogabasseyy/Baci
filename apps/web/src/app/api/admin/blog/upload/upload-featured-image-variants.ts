import type { NextResponse } from 'next/server';
import type {
  BlogFeaturedImageVariant,
  BlogFeaturedImageVariantsResult,
} from '@/lib/blog-featured-image-variants';
import type { createClient } from '@/lib/supabase/server';
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
 * Upload featured-image variants, staging each object immediately
 * after its storage write and before the next upload. A terminated
 * invocation then leaves every completed object reclaimable via its
 * tombstone instead of a permanent orphan the cron can never see.
 * Upload errors throw for the caller's cleanup; a staging failure
 * returns its response (the staged objects stay swept-safe).
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
    const variantStaging = await stageUploadedBlogMediaPaths(supabase, [
      variantPath,
    ]);
    if (variantStaging) return { response: variantStaging };
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
