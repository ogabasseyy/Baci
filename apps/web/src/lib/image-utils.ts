/**
 * Image Utilities for Blur Placeholders and Optimization
 *
 * Provides blur placeholder generation for smooth image loading UX.
 * Works with Next.js Image component across all merchant storefronts.
 */

/**
 * Color-based blur placeholders for different product categories
 * These provide contextually appropriate loading states
 */
const CATEGORY_BLUR_COLORS: Record<string, string> = {
  fashion: '#f5f0eb', // Warm beige
  electronics: '#e8eef4', // Cool blue-gray
  food: '#f0ebe5', // Warm cream
  beauty: '#fdf2f8', // Soft pink
  home: '#f5f5f4', // Neutral stone
  sports: '#ecfdf5', // Fresh green
  default: '#f4f4f5', // Neutral gray
};

// Served by apps/web/public/placeholder.svg.
export const PLACEHOLDER_IMAGE = '/placeholder.svg';

const EXTERNAL_PLACEHOLDER_IMAGE_HOSTS = new Set([
  'placehold.co',
  'placehold.it',
  'via.placeholder.com',
]);

/**
 * Generate a solid color blur data URL
 * Faster than image-based blur, good for product cards
 */
const colorBlurCache = new Map<string, string>();

function generateColorBlur(color: string = '#f4f4f5'): string {
  const cached = colorBlurCache.get(color);
  if (cached) return cached;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="${color}" width="1" height="1"/></svg>`;
  const nodeBuffer = (
    globalThis as {
      Buffer?: {
        from(input: string): { toString(encoding: string): string };
      };
    }
  ).Buffer;
  const base64 =
    typeof globalThis.btoa === 'function'
      ? globalThis.btoa(svg)
      : (nodeBuffer?.from(svg).toString('base64') ?? '');

  const result = `data:image/svg+xml;base64,${base64}`;
  colorBlurCache.set(color, result);
  return result;
}

/**
 * Get blur placeholder for a product based on its category
 */
export function getProductBlurPlaceholder(category?: string): string {
  const normalizedCategory = category?.toLowerCase() || 'default';
  const color =
    CATEGORY_BLUR_COLORS[normalizedCategory] || CATEGORY_BLUR_COLORS.default;
  return generateColorBlur(color);
}

/**
 * Calculate responsive image sizes based on layout
 * Helps browser load appropriately sized images
 */
export function getResponsiveSizes(
  layout: 'grid' | 'full' | 'thumbnail' | 'hero'
): string {
  switch (layout) {
    case 'grid':
      // Product grid: 2 cols on mobile, 3 on tablet, 4 on desktop
      return '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw';
    case 'full':
      // Full width product image
      return '(max-width: 768px) 100vw, 50vw';
    case 'thumbnail':
      // Small thumbnails (cart, gallery)
      return '80px';
    case 'hero':
      // Hero/banner images
      return '100vw';
    default:
      return '100vw';
  }
}

/**
 * Check if an image URL is valid and accessible
 * Optimized to avoid expensive try-catch blocks for common cases
 */
export function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;

  // Fast fail relative URLs (new URL('/foo') throws without base)
  if (url.startsWith('/')) return false;

  // Fallback for complex cases
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect external placeholder services that should not be emitted as real
 * product imagery.
 */
export function isExternalPlaceholderImageUrl(
  url: string | null | undefined
): boolean {
  if (!url || typeof url !== 'string') return false;

  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return EXTERNAL_PLACEHOLDER_IMAGE_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Get the local fallback image URL.
 */
export function getFallbackImage(): string {
  // Keep missing-image fallbacks local so crawlers do not depend on external
  // placeholder hosts that may be blocked or rate-limited.
  return PLACEHOLDER_IMAGE;
}
