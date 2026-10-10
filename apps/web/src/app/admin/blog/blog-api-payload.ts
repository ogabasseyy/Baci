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
  const inputAlt = toOptionalString(input.featured_image_alt);
  // Freshness is tracked explicitly: the editor sets this flag when the alt
  // field is hand-edited and resets it on every URL change, so "non-empty"
  // never stands in for "written for the current cover".
  const altEdited = input.featured_image_alt_edited === true;
  const imageUrlUnchanged =
    existingPost != null &&
    normalizeTrimmedString(input.featured_image_url) ===
      normalizeTrimmedString(existingPost.featured_image_url);
  // A blank alt with an unchanged URL is an undone URL edit — unless the
  // alt field itself was touched, in which case the blank is intentional.
  // A changed URL with unedited alt is a stale description: drop it rather
  // than attach the old cover's text to the new image.
  const storedAlt = existingPost?.featured_image_alt ?? null;
  const preservedAlt =
    !inputAlt && !altEdited && imageUrlUnchanged && storedAlt
      ? storedAlt
      : existingPost && !imageUrlUnchanged && !altEdited
        ? clearEmptyToNull
          ? null
          : undefined
        : inputAlt;
  // Alt text without an image is orphaned: force the clear even for
  // hand-edited text, on both create and PATCH.
  const hasImageUrl = normalizeTrimmedString(input.featured_image_url) !== '';
  const effectiveAlt = hasImageUrl
    ? preservedAlt
    : clearEmptyToNull
      ? null
      : undefined;

  const payload = {
    author_name: input.author_name,
    category: toOptionalString(input.category),
    content: input.content,
    excerpt: toOptionalString(input.excerpt),
    featured_image_alt: effectiveAlt,
    focus_keyword: toOptionalString(input.focus_keyword ?? ''),
    intent,
    intent_source: intentSource,
    seo_description: toOptionalString(input.seo_description),
    seo_title: toOptionalString(input.seo_title),
    slug: normalizeTrimmedString(input.slug) || undefined,
    status: input.status,
    tags: input.tags,
    title: input.title,
  };

  if (!includeFeaturedImageFields) {
    return payload;
  }

  const featuredImageUrl = toOptionalString(input.featured_image_url) || null;
  if (shouldResetFeaturedMetadataForChangedUrl(input, existingPost)) {
    // Only hand-edited alt text is fresh for the new cover; anything else
    // riding along with the changed URL is stale and resets to null, as
    // does any alt when the URL itself was removed.
    const featuredImageAlt =
      hasImageUrl && altEdited
        ? toOptionalString(input.featured_image_alt)
        : null;
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
