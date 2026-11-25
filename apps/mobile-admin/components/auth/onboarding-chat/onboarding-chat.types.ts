import type { User } from '@supabase/supabase-js';
import { requiresOwnerNameFields } from '@/components/auth/register/requires-owner-name-fields';
import { BUSINESS_TYPES } from '@/constants/business-types';
import { COUNTRIES } from '@/constants/countries';
import type { OnboardingBrandColors } from '@/hooks/useOnboardingAssist';

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

export const DEFAULT_BRAND_COLORS: OnboardingBrandColors = {
  primary: '#000000',
  background: '#ffffff',
  accent: '#f59e0b',
};

export const TOP_COUNTRY_CODES = ['NG', 'GH', 'KE', 'ZA', 'GB', 'US'] as const;

export function slugifyBusinessName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function sanitizeSlugInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/(^-|-$)/g, '');
}

function metadataString(user: User, key: string): string {
  const value = user.user_metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function ownerNamesFromMetadata(user: User): {
  firstName: string;
  lastName: string;
} {
  const fullName =
    metadataString(user, 'full_name') || metadataString(user, 'name');
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = metadataString(user, 'first_name') || nameParts[0] || '';
  const lastName =
    metadataString(user, 'last_name') || nameParts.slice(1).join(' ');

  return { firstName, lastName };
}

export function initialOnboardingChatData(user: User): OnboardingChatData {
  const { firstName, lastName } = ownerNamesFromMetadata(user);
  return {
    firstName,
    lastName,
    phone: '',
    businessName: '',
    businessType: '',
    otherBusinessType: '',
    country: 'NG',
    slug: '',
    slugIsCustom: false,
    // Never pre-seed personal OAuth avatars as public store branding.
    logoUrl: '',
    brandColors: DEFAULT_BRAND_COLORS,
  };
}

export function getInitialChatStep(
  data: OnboardingChatData
): OnboardingChatStep {
  return requiresOwnerNameFields(data.firstName, data.lastName)
    ? 'owner_name'
    : 'country';
}

export function getCountryName(code: string): string {
  return COUNTRIES.find((country) => country.code === code)?.name ?? code;
}

export function getBusinessTypeLabel(
  businessType: string,
  otherBusinessType?: string
): string {
  if (businessType === 'other' && otherBusinessType?.trim()) {
    return otherBusinessType.trim();
  }
  return (
    BUSINESS_TYPES.find((item) => item.id === businessType)?.label ??
    businessType
  );
}

export function buildWelcomeMessage(
  data: OnboardingChatData,
  step: OnboardingChatStep
): string {
  if (step === 'owner_name') {
    return "Hi! I'm Baci. Let's set up your store together in a couple of minutes. First, what's your full name?";
  }
  const greetingName = data.firstName ? `, ${data.firstName}` : '';
  return `Welcome to Baci${greetingName}! Let's set up your store together. Where is your business based?`;
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

export function createInitialConversation(user: User | null): {
  data: OnboardingChatData;
  step: OnboardingChatStep;
  messages: OnboardingChatMessage[];
} {
  const data = initialOnboardingChatData(
    user ?? ({ user_metadata: {} } as User)
  );
  const step = getInitialChatStep(data);
  return {
    data,
    step,
    messages: [
      {
        id: 'welcome',
        role: 'assistant',
        text: buildWelcomeMessage(data, step),
      },
    ],
  };
}
