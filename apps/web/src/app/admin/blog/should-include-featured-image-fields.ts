import { areBlogImageVariantsEqual } from './are-blog-image-variants-equal';
import type {
  PlatformAdminBlogFormState,
  PlatformAdminBlogPostDetail,
} from './blog-types';

export function shouldIncludeFeaturedImageFields(
  input: PlatformAdminBlogFormState,
  existingPost?: PlatformAdminBlogPostDetail | null
): boolean {
  if (!existingPost) return true;

  return (
    input.featured_image_url.trim() !==
      (existingPost.featured_image_url ?? '').trim() ||
    (input.featured_image_width ?? null) !==
      (existingPost.featured_image_width ?? null) ||
    (input.featured_image_height ?? null) !==
      (existingPost.featured_image_height ?? null) ||
    !areBlogImageVariantsEqual(
      input.featured_image_variants,
      existingPost.featured_image_variants
    )
  );
}
