import type { ReactElement } from 'react';
import {
  getMerchantBlogOgImageData,
  getMerchantBlogOgMetadataData,
} from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-data';
import {
  renderGenericFallback,
  renderMerchantFallback,
  renderPrimaryCard,
} from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-markup';
import { createBlogOgImageResponse } from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-response';

export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';
type ImageProps = { params: Promise<{ slug: string; postSlug: string }> };
type ImageResponseFallback = { element: ReactElement };

function createImageResponse(
  element: ReactElement,
  fallback?: ImageResponseFallback
) {
  return createBlogOgImageResponse(element, {
    size,
    fallback,
  });
}

export async function generateImageMetadata({ params }: ImageProps) {
  const { slug, postSlug } = await params;
  const data = await getMerchantBlogOgMetadataData(slug, postSlug);
  const alt = data?.post?.title
    ? `${data.post.title} — ${data.merchantBusinessName}`
    : 'Blog post';

  return [
    {
      id: 'merchant-blog-og',
      alt,
      size,
      contentType,
    },
  ];
}

export default async function Image({ params }: ImageProps) {
  let data: Awaited<ReturnType<typeof getMerchantBlogOgImageData>>;
  try {
    const { slug, postSlug } = await params;
    data = await getMerchantBlogOgImageData(slug, postSlug);
  } catch (error) {
    console.error('Failed to resolve merchant blog OG image', { error });
    return createImageResponse(renderGenericFallback('Post Not Found'));
  }

  if (!data) {
    return createImageResponse(renderGenericFallback('Post Not Found'));
  }

  if (!data.post) {
    return createImageResponse(renderMerchantFallback(data, 'Post Not Found'), {
      element: renderGenericFallback('Post Not Found'),
    });
  }

  if (!data.featuredDataUri) {
    return createImageResponse(
      renderMerchantFallback(data, data.post.title || 'Blog post'),
      {
        element: renderGenericFallback(data.post.title || 'Blog post'),
      }
    );
  }

  return createImageResponse(renderPrimaryCard(data), {
    element: renderMerchantFallback(data, data.post.title || 'Blog post'),
  });
}
