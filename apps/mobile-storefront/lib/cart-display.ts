import { PLACEHOLDER_IMAGE_URL } from '@/constants/Images';

const COLOR_HEX_MAP: Record<string, string> = {
  black: '#1a1a1a',
  'space black': '#1a1a1a',
  'midnight black': '#0d0d0d',
  white: '#FFFFFF',
  silver: '#C0C0C0',
  gold: '#F5E0C3',
  'rose gold': '#E8B4A0',
  blue: '#3B82F6',
  'sierra blue': '#69ABCE',
  'pacific blue': '#2D5F7C',
  'deep purple': '#6B21A8',
  purple: '#9333EA',
  red: '#EF4444',
  'product red': '#EF4444',
  green: '#22C55E',
  'alpine green': '#505E48',
  yellow: '#FCD34D',
  orange: '#FB923C',
  pink: '#EC4899',
  gray: '#6B7280',
  graphite: '#4A4A4A',
  'natural titanium': '#8A8D8F',
  'blue titanium': '#3F4E57',
  'black titanium': '#3D3D3D',
  'white titanium': '#E8E8E8',
};

function normalizeImageCandidate(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

export function resolveCartItemImageUrl(options: {
  displayedImageUrl?: string | null;
  fallbackImageUrl?: string | null;
  variantImageUrl?: string | null;
  variantImages?: string[] | null;
}) {
  const displayedImageUrl = normalizeImageCandidate(options.displayedImageUrl);

  return (
    (displayedImageUrl === PLACEHOLDER_IMAGE_URL
      ? undefined
      : displayedImageUrl) ||
    normalizeImageCandidate(options.variantImageUrl) ||
    options.variantImages?.map(normalizeImageCandidate).find(Boolean) ||
    normalizeImageCandidate(options.fallbackImageUrl) ||
    PLACEHOLDER_IMAGE_URL
  );
}

/** Resolve merchant colour names, optionally requiring a complete named-colour match. */
export function resolveColorSwatchValue(
  colorName: string | null | undefined,
  options: { exact?: boolean } = {}
) {
  if (typeof colorName !== 'string') {
    return undefined;
  }

  const normalizedName = colorName.trim().toLowerCase();
  if (!normalizedName) {
    return undefined;
  }

  if (COLOR_HEX_MAP[normalizedName]) {
    return COLOR_HEX_MAP[normalizedName];
  }

  if (options.exact) return undefined;

  for (const [key, value] of Object.entries(COLOR_HEX_MAP)) {
    if (normalizedName.includes(key)) {
      return value;
    }
  }

  return undefined;
}
