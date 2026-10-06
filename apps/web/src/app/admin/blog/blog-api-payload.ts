import { areBlogImageVariantsEqual } from './are-blog-image-variants-equal';
import type {
  PlatformAdminBlogFormState,
  PlatformAdminBlogPostDetail,
} from './blog-types';

export function toApiPayload(
  input: PlatformAdminBlogFormState,
  {
    clearEmptyToNull = false,
    existingPost = null,
    includeFeaturedImageFields = true,
  }: {
    clearEmptyToNull?: boolean;
    existingPost?: PlatformAdminBlogPostDetail | null;
    includeFeaturedImageFields?: boolean;
  } = {}
) {
  const toOptionalString = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }

    return clearEmptyToNull ? null : undefined;
  };

  const intent = input.intent || (clearEmptyToNull ? null : undefined);
  // Provenance without an intent is an orphan: keep the pair consistent by
  // clearing the source whenever the effective intent is nullish.
  const intentSource = intent
    ? toOptionalString(input.intent_source ?? '')
    : clearEmptyToNull
      ? null
      : undefined;

  const payload = {
    author_name: input.author_name,
    category: toOptionalString(input.category),
    content: input.content,
    excerpt: toOptionalString(input.excerpt),
    featured_image_alt: toOptionalString(input.featured_image_alt),
    focus_keyword: toOptionalString(input.focus_keyword ?? ''),
    intent,
    intent_source: intentSource,
    seo_description: toOptionalString(input.seo_description),
    seo_title: toOptionalString(input.seo_title),
    slug: input.slug.trim() || undefined,
    status: input.status,
    tags: input.tags,
    title: input.title,
  };

  if (!includeFeaturedImageFields) {
    return payload;
  }

  const featuredImageUrl = toOptionalString(input.featured_image_url) || null;
  if (shouldResetFeaturedMetadataForChangedUrl(input, existingPost)) {
    // Stale alt text always arrives empty (the editor clears it on URL edits
    // and uploads), so a non-empty value here is fresh for the new cover.
    const featuredImageAlt = toOptionalString(input.featured_image_alt);
    return {
      ...payload,
      featured_image_alt: featuredImageAlt || null,
      featured_image_height: null,
      featured_image_url: featuredImageUrl,
      featured_image_variants: {},
      featured_image_width: null,
    };
  }

  return {
    ...payload,
    featured_image_height: input.featured_image_height,
    featured_image_url: featuredImageUrl,
    featured_image_variants: input.featured_image_variants,
    featured_image_width: input.featured_image_width,
  };
}

function normalizeTrimmedString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shouldResetFeaturedMetadataForChangedUrl(
  input: PlatformAdminBlogFormState,
  existingPost?: PlatformAdminBlogPostDetail | null
): boolean {
  if (!existingPost) {
    return false;
  }

  if (
    normalizeTrimmedString(input.featured_image_url) ===
    normalizeTrimmedString(existingPost.featured_image_url)
  ) {
    return false;
  }

  if (
    (input.featured_image_width ?? null) !==
      (existingPost.featured_image_width ?? null) ||
    (input.featured_image_height ?? null) !==
      (existingPost.featured_image_height ?? null)
  ) {
    return false;
  }

  return areBlogImageVariantsEqual(
    input.featured_image_variants,
    existingPost.featured_image_variants
  );
}
