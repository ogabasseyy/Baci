import { ImageResponse } from 'next/og';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { isDomainIdentifier } from '@/lib/validation';

// Region pinning lives in vercel.json `regions` (dub1, next to the Supabase
// primary in eu-west-1 / Dublin) — `preferredRegion` is deprecated and removed.

export const alt = 'Store Preview';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

interface ImageProps {
  params: Promise<{ slug: string }>;
}

export default async function Image({ params }: ImageProps) {
  const { slug } = await params;

  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(slug)
    : await getCachedMerchant(slug);

  if (!merchant) {
    // Return a default fallback image
    return new ImageResponse(
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
        <div style={{ fontSize: 60, fontWeight: 'bold' }}>Store Not Found</div>
      </div>,
      { ...size }
    );
  }

  // Get brand colors with fallbacks
  const primaryColor = merchant.brand_colors?.primary || '#3B82F6';
  const bgColor = merchant.brand_colors?.background || '#1a1a2e';
  const accentColor = merchant.brand_colors?.accent || '#F59E0B';

  // Get tagline or description
  const tagline =
    merchant.site_tagline ||
    merchant.site_description ||
    `Welcome to ${merchant.business_name}`;

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: bgColor,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background gradient overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `linear-gradient(135deg, ${bgColor} 0%, ${primaryColor}20 50%, ${accentColor}20 100%)`,
        }}
      />

      {/* Decorative shapes */}
      <div
        style={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: `${primaryColor}30`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -150,
          left: -150,
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: `${accentColor}20`,
        }}
      />

      {/* Content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '60px',
          position: 'relative',
        }}
      >
        {/* Logo */}
        {merchant.logo_url && (
          // biome-ignore lint/performance/noImgElement: Satori (OpenGraph image generation) requires img tags
          <img
            src={merchant.logo_url}
            alt=""
            width={120}
            height={120}
            style={{
              objectFit: 'contain',
              marginBottom: 30,
              borderRadius: 16,
            }}
          />
        )}

        {/* Business Name */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 'bold',
            color: 'white',
            textAlign: 'center',
            marginBottom: 20,
            letterSpacing: '-0.02em',
          }}
        >
          {merchant.business_name}
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 28,
            color: 'rgba(255,255,255,0.8)',
            textAlign: 'center',
            maxWidth: 800,
            lineHeight: 1.4,
          }}
        >
          {tagline.length > 100 ? `${tagline.slice(0, 100)}...` : tagline}
        </div>

        {/* CTA Button */}
        <div
          style={{
            display: 'flex',
            marginTop: 40,
            padding: '16px 40px',
            backgroundColor: primaryColor,
            borderRadius: 12,
            fontSize: 24,
            fontWeight: 600,
            color: 'white',
          }}
        >
          Shop Now
        </div>
      </div>

      {/* Powered by badge */}
      <div
        style={{
          position: 'absolute',
          bottom: 30,
          right: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 16,
          color: 'rgba(255,255,255,0.5)',
        }}
      >
        Powered by Baci
      </div>
    </div>,
    {
      ...size,
    }
  );
}
