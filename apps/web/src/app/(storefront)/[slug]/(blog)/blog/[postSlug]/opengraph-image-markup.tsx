import {
  getBlogOgBrandColors,
  getTransparentBlogOgBrandColors,
} from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-colors';
import type { MerchantBlogOgImageData } from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-data';
import { getBlogOgForegroundColor } from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-foreground-color';

function getSatoriSafeText(value: string | null | undefined): string {
  return (value || '').replace(/₦\s*/g, 'NGN ').replace(/\s+/g, ' ').trim();
}

function truncate(value: string | null | undefined, maxLength: number): string {
  const safeValue = getSatoriSafeText(value);
  if (!safeValue) return '';
  if (maxLength <= 0) return '';
  if (maxLength <= 3 && safeValue.length > maxLength) {
    return '.'.repeat(maxLength);
  }
  return safeValue.length > maxLength
    ? `${safeValue.slice(0, maxLength - 3)}...`
    : safeValue;
}

export function renderGenericFallback(title: string) {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a1a2e',
        color: 'white',
      }}
    >
      <div style={{ fontSize: 60, fontWeight: 400 }}>
        {getSatoriSafeText(title)}
      </div>
    </div>
  );
}

export function renderMerchantFallback(
  data: MerchantBlogOgImageData,
  title: string
) {
  const colors = getBlogOgBrandColors(data);
  const transparentColors = getTransparentBlogOgBrandColors(colors);
  const foreground = getBlogOgForegroundColor(colors.background, [
    transparentColors.primary20,
    transparentColors.accent15,
  ]);

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: colors.background,
        color: foreground,
        padding: '60px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, ${colors.background} 0%, ${transparentColors.primary20} 55%, ${transparentColors.accent15} 100%)`,
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          position: 'relative',
        }}
      >
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
        <div style={{ fontSize: 30, fontWeight: 400 }}>
          {getSatoriSafeText(data.merchantBusinessName)}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          maxWidth: 880,
          position: 'relative',
        }}
      >
        <div
          style={{
            color: foreground,
            fontSize: 24,
            fontWeight: 400,
            textTransform: 'uppercase',
          }}
        >
          Blog
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 400,
            lineHeight: 1.05,
          }}
        >
          {truncate(title, 96)}
        </div>
      </div>
    </div>
  );
}

export function renderPrimaryCard(data: MerchantBlogOgImageData) {
  const colors = getBlogOgBrandColors(data);
  const transparentColors = getTransparentBlogOgBrandColors(colors);
  const foreground = getBlogOgForegroundColor(colors.background, [
    transparentColors.primary15,
  ]);
  const post = data.post;
  const title = post?.title || 'Blog post';

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        backgroundColor: colors.background,
        color: foreground,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: 650,
          height: '100%',
          display: 'flex',
          backgroundColor: transparentColors.primary13,
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
          width: 550,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px',
          background: `linear-gradient(135deg, ${colors.background} 0%, ${transparentColors.primary15} 100%)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
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
            {getSatoriSafeText(data.merchantBusinessName)}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          {post?.category ? (
            <div
              style={{
                color: foreground,
                fontSize: 22,
                fontWeight: 400,
                textTransform: 'uppercase',
              }}
            >
              {getSatoriSafeText(post.category)}
            </div>
          ) : null}
          <div
            style={{
              fontSize: 56,
              fontWeight: 400,
              lineHeight: 1.08,
            }}
          >
            {truncate(title, 82)}
          </div>
          {post?.author_name ? (
            <div style={{ color: foreground, fontSize: 22 }}>
              {`By ${getSatoriSafeText(post.author_name)}`}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
