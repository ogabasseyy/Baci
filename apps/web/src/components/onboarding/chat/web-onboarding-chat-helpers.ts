import type {
  OnboardingBrandColors,
  OnboardingBusinessTypeOption,
  OnboardingChatStep,
} from '@baci/shared/onboarding-chat';
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
