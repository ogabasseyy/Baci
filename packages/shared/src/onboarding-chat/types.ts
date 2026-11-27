export interface OnboardingBrandColors {
  primary: string;
  background: string;
  accent: string;
}

export type OnboardingChatStep =
  | 'owner_name'
  | 'country'
  | 'phone'
  | 'business_type'
  | 'other_business_type'
  | 'business_name'
  | 'ai_name_description'
  | 'logo'
  | 'logo_generate_offer'
  | 'slug'
  | 'summary';

export interface OnboardingChatData {
  firstName: string;
  lastName: string;
  phone: string;
  businessName: string;
  businessType: string;
  otherBusinessType: string;
  country: string;
  slug: string;
  slugIsCustom: boolean;
  logoUrl: string;
  brandColors: OnboardingBrandColors;
}

export interface OnboardingChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  text: string;
  logoPreviewUri?: string;
  brandColors?: OnboardingBrandColors;
  isSummary?: boolean;
}

export interface QuickReplyOption {
  id: string;
  label: string;
  variant?: 'default' | 'accent' | 'secondary';
}

export interface OnboardingCountryOption {
  code: string;
  name: string;
}

export interface OnboardingBusinessTypeOption {
  id: string;
  label: string;
}

export const DEFAULT_BRAND_COLORS: OnboardingBrandColors = {
  primary: '#000000',
  background: '#ffffff',
  accent: '#f59e0b',
};

export const TOP_COUNTRY_CODES = ['NG', 'GH', 'KE', 'ZA', 'GB', 'US'] as const;

const STORE_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// Mirror of public.is_reserved_merchant_slug() so auto-derived preview slugs
// never display a reserved label that the server will rewrite on submit.
const RESERVED_ONBOARDING_SLUGS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'mail',
  'smtp',
  'assets',
  'static',
  'cdn',
  'status',
  'support',
  'help',
  'chat',
  'cart',
  'checkout',
  'auth',
  'login',
  'logout',
  'builder',
  'onboarding',
  'preview',
  'about',
  'contact',
  'blog',
  'pricing',
  'terms',
  'privacy',
  'faq',
  'features',
  'demo',
  'developers',
  'track',
  'invite',
  'reset-password',
  'template-preview',
  'orders',
  'saved',
  'addresses',
  'reviews',
  'wallet',
  'repairs',
  'swap',
  'account',
  'delete-account',
  'images',
  'product',
  'staff',
  'signup',
  'forgot-password',
  'update-password',
  'verify',
]);

export function sanitizeSlugInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isReservedStoreSlug(slug: string): boolean {
  return RESERVED_ONBOARDING_SLUGS.has(slug.trim().toLowerCase());
}

export function isValidStoreSlug(slug: string): boolean {
  return (
    slug.length >= 3 &&
    slug.length <= 63 &&
    STORE_SLUG_PATTERN.test(slug) &&
    !isReservedStoreSlug(slug)
  );
}

export function slugifyBusinessName(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  if (!base) return 'my-store';
  if (base.length < 3 || RESERVED_ONBOARDING_SLUGS.has(base)) {
    return `${base}-store`;
  }
  return base;
}

export function parseFullNameInput(
  input: string
): { firstName: string; lastName: string } | null {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

/**
 * Collapses whitespace in a person's name while preserving intentionally mixed
 * casing (e.g. "McDonald", "O'Brien", "DeLaCruz"). Only all-lowercase or
 * all-uppercase tokens are title-cased.
 */
export function normalizePersonName(value: string): string {
  const collapsed = value.trim().replace(/\s+/g, ' ');
  if (!collapsed) return '';
  return collapsed
    .split(' ')
    .map((word) => {
      if (word !== word.toLowerCase() && word !== word.toUpperCase()) {
        return word;
      }
      return word
        .toLowerCase()
        .replace(
          /(^|['-])([a-z])/g,
          (_, separator: string, char: string) =>
            `${separator}${char.toUpperCase()}`
        );
    })
    .join(' ');
}

export function isValidOnboardingPhone(value: string): boolean {
  const trimmed = value.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');
  return (
    /^[+\d\s()-]+$/.test(trimmed) &&
    digitsOnly.length >= 7 &&
    digitsOnly.length <= 15
  );
}
