import {
  DEFAULT_BRAND_COLORS,
  type OnboardingBrandColors,
  type OnboardingBusinessTypeOption,
  type OnboardingChatData,
  type OnboardingChatStep,
  parseFullNameInput,
} from '@baci/shared/onboarding-chat';
import type { User } from '@supabase/supabase-js';
import { BUSINESS_TYPES } from '@/config/business-types';
import { COUNTRIES, getCountryByCode } from '@/lib/countries';
import { buildCsrfHeaders } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/client';

export type AccountPhaseStep =
  | 'auth_choice'
  | 'auth_name'
  | 'auth_email'
  | 'auth_magic_email'
  | 'auth_password'
  | 'auth_confirm'
  | 'auth_check_email';

export type WebChatStep = AccountPhaseStep | OnboardingChatStep;

export interface WebOnboardingAssistRequest {
  task: 'generate_names' | 'generate_logos' | 'extract_colors';
  businessName: string;
  businessType: string;
  brandPreferences: string;
  description?: string;
  tone?: string;
  logoUrl?: string;
}

export interface WebOnboardingAssistResponse {
  businessNames?: string[];
  logos?: string[];
  brandColors?: OnboardingBrandColors;
}

export const WEB_ONBOARDING_ASSIST_TIMEOUT_MS = 55_000;

const ALLOWED_WEB_LOGO_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export const WEB_BUSINESS_TYPES: readonly OnboardingBusinessTypeOption[] =
  (() => {
    const fromConfig = Object.values(BUSINESS_TYPES).map((item) => ({
      id: item.id,
      label: item.label,
    }));
    const hasOther = fromConfig.some((item) => item.id === 'other');
    return hasOther
      ? fromConfig
      : [...fromConfig, { id: 'other', label: 'Other' }];
  })();

export const WEB_COUNTRIES = COUNTRIES.map((country) => ({
  code: country.code,
  name: country.name,
  flag: country.flag,
}));

export function getWebBusinessTypeLabel(
  businessType: string,
  otherBusinessType?: string
): string {
  if (businessType === 'other' && otherBusinessType?.trim()) {
    return otherBusinessType.trim();
  }
  return (
    WEB_BUSINESS_TYPES.find((item) => item.id === businessType)?.label ??
    businessType
  );
}

export function getWebCountryName(code: string): string {
  return getCountryByCode(code)?.name ?? code;
}

export function extractUserNames(user: User): {
  firstName: string;
  lastName: string;
} {
  const meta = user.user_metadata ?? {};
  const full = String(meta.full_name || meta.name || '').trim();
  const parts = full.split(/\s+/).filter(Boolean);
  return {
    firstName: String(meta.first_name || parts[0] || '').trim(),
    lastName: String(meta.last_name || parts.slice(1).join(' ') || '').trim(),
  };
}

export function buildInitialWebStoreData(
  user: User | null
): OnboardingChatData {
  const { firstName, lastName } = user
    ? extractUserNames(user)
    : { firstName: '', lastName: '' };
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
    logoUrl: '',
    brandColors: DEFAULT_BRAND_COLORS,
  };
}

export function isAllowedWebLogoFile(file: File): boolean {
  const normalized = file.type.trim().toLowerCase();
  const mime = normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  return ALLOWED_WEB_LOGO_MIMES.has(mime);
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  return 'png';
}

/**
 * Uploads a validated raster logo file to the user-scoped onboarding folder in
 * Supabase Storage (`images/onboarding/${userId}/...`).
 */
export async function uploadWebOnboardingLogo(
  file: File,
  userId: string
): Promise<string> {
  if (!isAllowedWebLogoFile(file)) {
    throw new Error('Please upload a PNG, JPEG, or WebP image.');
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error('Logo image must be smaller than 4 MB.');
  }

  const supabase = createClient();
  const ext = extensionForMime(file.type);
  const path = `onboarding/${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('images').upload(path, file, {
    contentType: file.type === 'image/jpg' ? 'image/jpeg' : file.type,
    upsert: true,
  });
  if (error) {
    throw new Error('Could not upload your logo right now. Please try again.');
  }
  const { data } = supabase.storage.from('images').getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Uploads an AI-generated raster data URI to `images/onboarding/${userId}/...`
 * so `submitOnboarding` receives a persisted HTTPS storage URL.
 */
export async function uploadWebDataUriLogo(
  dataUri: string,
  userId: string
): Promise<string> {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i.exec(
      dataUri.trim()
    );
  if (!match) {
    throw new Error('Unsupported logo format.');
  }
  const [, mimeType, base64] = match;
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const ext = extensionForMime(mimeType);
  const file = new File([bytes], `store-logo.${ext}`, { type: mimeType });
  return await uploadWebOnboardingLogo(file, userId);
}

export async function requestWebOnboardingAssist(
  payload: WebOnboardingAssistRequest
): Promise<WebOnboardingAssistResponse> {
  const response = await fetch('/api/onboarding/assist', {
    method: 'POST',
    credentials: 'same-origin',
    headers: buildCsrfHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(WEB_ONBOARDING_ASSIST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      errorData?.error || 'Unable to complete AI onboarding request right now.'
    );
  }

  return (await response.json()) as WebOnboardingAssistResponse;
}

function isDuplicateSignupError(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === 'user_already_exists' ||
    /already\s+(exists|registered)|user\s+already/i.test(error.message ?? '')
  );
}

export type WebEmailPasswordAuthOutcome =
  | { status: 'authenticated'; user: User }
  | { status: 'existing_wrong_password' }
  | { status: 'confirm_email' }
  | { status: 'error'; message: string };

/**
 * Creates a new email/password account or signs into an existing confirmed
 * account when Supabase reports a duplicate registration (either explicitly
 * or via an obfuscated `identities: []` response).
 */
export async function submitWebEmailPasswordAuth(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<WebEmailPasswordAuthOutcome> {
  const parsedName = parseFullNameInput(input.fullName);
  const supabase = createClient();
  const { data: signUpData, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        full_name: input.fullName,
        first_name: parsedName?.firstName ?? '',
        last_name: parsedName?.lastName ?? '',
      },
      emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
    },
  });
  const isExistingAccount =
    (error ? isDuplicateSignupError(error) : false) ||
    (!error &&
      !signUpData.session &&
      Array.isArray(signUpData.user?.identities) &&
      signUpData.user.identities.length === 0);
  if (isExistingAccount) {
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });
    if (!signInError && signInData.user) {
      return { status: 'authenticated', user: signInData.user };
    }
    return { status: 'existing_wrong_password' };
  }
  if (error) {
    return {
      status: 'error',
      message: error.message || 'Could not create your account. Try again.',
    };
  }
  if (signUpData.session && signUpData.user) {
    return { status: 'authenticated', user: signUpData.user };
  }
  return { status: 'confirm_email' };
}
