import { ImageResponse } from 'next/og';
import type { ReactElement } from 'react';
import {
  getPlatformBlogOgImageData,
  getPlatformBlogOgMetadataData,
  type PlatformBlogOgImageData,
  type RemoteImageLoadStatus,
} from '@/app/(platform)/blog/[slug]/opengraph-image-data';

export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' };
const PLATFORM_COLORS = {
  accent: '#F59E0B',
  background: '#0F172A',
  panel: '#1E293B',
};

type ImageProps = { params: Promise<{ slug: string }> };

function truncate(value: string | null | undefined, maxLength: number): string {
  if (!value) return '';
  if (maxLength <= 0) return '';
  if (maxLength <= 3 && value.length > maxLength) {
    return '.'.repeat(maxLength);
  }

  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}

function isTransientImageStatus(status: RemoteImageLoadStatus): boolean {
  return !['source_missing', 'source_disallowed', 'loaded'].includes(status);
}

function createImageResponse(element: ReactElement, noStore = false) {
  return new ImageResponse(element, {
    ...size,
    ...(noStore ? { headers: NO_STORE_HEADERS } : {}),
  });
}

function renderGenericFallback(title: string) {
  return (
    <div
      style={{
        alignItems: 'center',
        backgroundColor: PLATFORM_COLORS.background,
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      <div style={{ fontSize: 60, fontWeight: 400 }}>{title}</div>
    </div>
  );
}

function renderPlatformFallback(data: PlatformBlogOgImageData, title: string) {
  return (
    <div
      style={{
        background:
          'linear-gradient(135deg, #0F172A 0%, #111827 60%, #1E293B 100%)',
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'space-between',
        overflow: 'hidden',
        padding: '60px',
        width: '100%',
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: 16 }}>
        {data.logoDataUri ? (
          // biome-ignore lint/performance/noImgElement: Satori requires img tags for ImageResponse rendering
          <img
            src={data.logoDataUri}
            alt=""
            width={64}
            height={64}
            style={{ borderRadius: 14, objectFit: 'contain' }}
          />
        ) : null}
        <div style={{ fontSize: 30, fontWeight: 400 }}>{data.businessName}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div
          style={{
            color: PLATFORM_COLORS.accent,
            fontSize: 24,
            fontWeight: 400,
            textTransform: 'uppercase',
          }}
        >
          Blog
        </div>
        <div style={{ fontSize: 72, fontWeight: 400, lineHeight: 1.05 }}>
          {truncate(title, 96)}
        </div>
      </div>
    </div>
  );
}

function renderPrimaryCard(data: PlatformBlogOgImageData) {
  const post = data.post;
  const title = post?.title || 'Blog post';

  return (
    <div
      style={{
        backgroundColor: PLATFORM_COLORS.background,
        color: 'white',
        display: 'flex',
        height: '100%',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <div
        style={{
          backgroundColor: 'rgba(245, 158, 11, 0.08)',
          display: 'flex',
          height: '100%',
          width: 650,
        }}
      >
        {data.featuredDataUri ? (
          // biome-ignore lint/performance/noImgElement: Satori requires img tags for ImageResponse rendering
          <img
            src={data.featuredDataUri}
            alt=""
            width={650}
            height={630}
            style={{ objectFit: 'cover' }}
          />
        ) : null}
      </div>
      <div
        style={{
          background: `linear-gradient(135deg, ${PLATFORM_COLORS.background} 0%, ${PLATFORM_COLORS.panel} 100%)`,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          justifyContent: 'space-between',
          padding: '56px',
          width: 550,
        }}
      >
        <div style={{ alignItems: 'center', display: 'flex', gap: 14 }}>
          {data.logoDataUri ? (
            // biome-ignore lint/performance/noImgElement: Satori requires img tags for ImageResponse rendering
            <img
              src={data.logoDataUri}
              alt=""
              width={54}
              height={54}
              style={{ borderRadius: 12, objectFit: 'contain' }}
            />
          ) : null}
          <div style={{ fontSize: 26, fontWeight: 400 }}>
            {data.businessName}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {post?.category ? (
            <div
              style={{
                color: PLATFORM_COLORS.accent,
                fontSize: 22,
                fontWeight: 400,
                textTransform: 'uppercase',
              }}
            >
              {post.category}
            </div>
          ) : null}
          <div style={{ fontSize: 56, fontWeight: 400, lineHeight: 1.08 }}>
            {truncate(title, 82)}
          </div>
          {post?.author_name ? (
            <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 22 }}>
              By {post.author_name}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export async function generateImageMetadata({ params }: ImageProps) {
  const { slug } = await params;
  const data = await getPlatformBlogOgMetadataData(slug);
  const alt = data.post?.title
    ? `${data.post.title} — ${data.businessName}`
    : 'Blog post';

  return [
    {
      id: 'platform-blog-og',
      alt,
      size,
      contentType,
    },
  ];
}

export default async function Image({ params }: ImageProps) {
  const { slug } = await params;
  const data = await getPlatformBlogOgImageData(slug);

  if (!data) {
    return createImageResponse(renderGenericFallback('Post Not Found'), true);
  }

  if (!data.post) {
    return createImageResponse(renderPlatformFallback(data, 'Post Not Found'));
  }

  if (!data.featuredDataUri) {
    return createImageResponse(
      renderPlatformFallback(data, data.post.title || 'Blog post'),
      isTransientImageStatus(data.featuredImageStatus)
    );
  }

  return createImageResponse(renderPrimaryCard(data));
}
