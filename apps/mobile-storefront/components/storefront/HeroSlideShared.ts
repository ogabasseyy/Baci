/** Shared constants, image helpers, and prop types for hero slide variants. */
import type { useTheme } from '@/hooks/useTheme';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { getHeroStyles } from './Hero.styles';

export type HeroThemeColors = ReturnType<typeof useTheme>['colors'];
export type HeroVariantStyles = ReturnType<typeof getHeroStyles>;

export const CAROUSEL_HEIGHT = 450;
export const STANDARD_HEIGHT = 220;

// Default Blurhash for hero images (neutral gradient)
const DEFAULT_HERO_BLURHASH = 'L6PZfSi_.AyE_3t7t7RjE1%MWBR*';

// 2026 Best Practice: Common image props for offline caching
export const heroImageProps = {
  placeholder: { blurhash: DEFAULT_HERO_BLURHASH },
  transition: 300,
  cachePolicy: 'memory-disk' as const, // Persist images for offline viewing
  autoplay: false,
};

export function getHeroImageSource(uri: string, width: number, height: number) {
  return createSafeBoundedImageSource({ height, uri, width });
}

export const getCoverHeroImageSource = (
  uri: string,
  width: number,
  height: number
) => createSafeBoundedImageSource({ fit: 'cover', height, uri, width });
