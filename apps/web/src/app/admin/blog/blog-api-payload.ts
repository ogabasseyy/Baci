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

  const payload = {
    author_name: input.author_name,
    category: toOptionalString(input.category),
    content: input.content,
    excerpt: toOptionalString(input.excerpt),
    featured_image_alt: toOptionalString(input.featured_image_alt),
    focus_keyword: toOptionalString(input.focus_keyword ?? ''),
    intent: input.intent || (clearEmptyToNull ? null : undefined),
    intent_source: toOptionalString(input.intent_source ?? ''),
    seo_description: toOptionalString(input.seo_description),
    seo_title: toOptionalString(input.seo_title),
    slug: input.slug || undefined,
    status: input.status,
    tags: input.tags,
    title: input.title,
  };

  if (!includeFeaturedImageFields) {
    return payload;
  }

  const featuredImageUrl = toOptionalString(input.featured_image_url) || null;
  if (shouldResetFeaturedMetadataForChangedUrl(input, existingPost)) {
    return {
      ...payload,
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

function areVariantMapsEqual(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined
): boolean {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (let index = 0; index < leftEntries.length; index += 1) {
    const [leftKey, leftValue] = leftEntries[index];
    const [rightKey, rightValue] = rightEntries[index];
    if (leftKey !== rightKey || leftValue !== rightValue) {
      return false;
    }
  }

  return true;
}

export function shouldIncludeFeaturedImageFields(
  input: PlatformAdminBlogFormState,
  existingPost?: PlatformAdminBlogPostDetail | null
): boolean {
  if (!existingPost) {
    return true;
  }

  if (
    normalizeTrimmedString(input.featured_image_url) !==
    normalizeTrimmedString(existingPost.featured_image_url)
  ) {
    return true;
  }

  if (
    (input.featured_image_width ?? null) !==
      (existingPost.featured_image_width ?? null) ||
    (input.featured_image_height ?? null) !==
      (existingPost.featured_image_height ?? null)
  ) {
    return true;
  }

  return !areVariantMapsEqual(
    input.featured_image_variants,
    existingPost.featured_image_variants
  );
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

  return areVariantMapsEqual(
    input.featured_image_variants,
    existingPost.featured_image_variants
  );
}
