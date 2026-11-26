import type { User } from '@supabase/supabase-js';
import { getCountryByCode } from '@/lib/countries';
import type { createClient as createServerClient } from '@/lib/supabase/server';
import type {
  OnboardingBrandColors,
  OnboardingMerchant,
} from './onboarding-action-types';
import {
  hasEstablishedOnboardingSlug,
  resolveOnboardingMerchantSlug,
} from './onboarding-slug';

type OnboardingMerchantClient = Pick<
  Awaited<ReturnType<typeof createServerClient>>,
  'from' | 'rpc'
>;

const LEGACY_COMPLETED_BUSINESS_TYPE = 'general';

interface UpsertOnboardingMerchantInput {
  brandColors: OnboardingBrandColors;
  brandColorsParsed: boolean;
  businessName: string;
  businessType: string;
  country: string;
  email: string;
  logoUrl?: string;
  otherBusinessType?: string;
  phone?: string;
  slug?: string;
  slugIsCustom?: boolean;
  supabase: OnboardingMerchantClient;
  user: User;
}

export class OnboardingSlugUnavailableError extends Error {
  constructor() {
    super('That store link is already taken. Please choose another.');
    this.name = 'OnboardingSlugUnavailableError';
  }
}

function isSlugUniqueViolation(error: {
  code?: string;
  message: string;
}): boolean {
  return (
    error.code === '23505' ||
    /duplicate key value violates unique constraint.*slug/i.test(error.message)
  );
}

export type UpsertOnboardingMerchantResult =
  | {
      status: 'completed';
      businessName: string;
      businessType: string;
      merchant: OnboardingMerchant;
    }
  | {
      status: 'saved';
      businessName: string;
      businessType: string;
      merchant: OnboardingMerchant;
    };

export async function upsertOnboardingMerchant({
  brandColors,
  brandColorsParsed,
  businessName,
  businessType,
  country,
  email,
  logoUrl,
  otherBusinessType,
  phone,
  slug: requestedSlug,
  slugIsCustom,
  supabase,
  user,
}: UpsertOnboardingMerchantInput): Promise<UpsertOnboardingMerchantResult> {
  const normalizedLogoUrl = logoUrl?.trim() ? logoUrl.trim() : null;
  const normalizedPhone = phone?.trim() ? phone.trim() : undefined;
  const finalBusinessType =
    businessType === 'other' ? otherBusinessType || businessType : businessType;
  const payoutCurrency = getCountryByCode(country)?.currency ?? 'USD';
  const merchants = supabase.from('merchants') as unknown as {
    select: (columns: string) => {
      eq: (
        column: 'user_id',
        value: string
      ) => {
        maybeSingle: () => Promise<{
          data: OnboardingMerchant | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (
        column: 'id',
        value: string
      ) => {
        eq: (
          column: 'user_id',
          value: string
        ) => {
          select: (columns: string) => {
            single: () => Promise<{
              data: OnboardingMerchant | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
    insert: (values: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{
          data: OnboardingMerchant | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  const lookup = await merchants
    .select(
      'id, business_name, business_type, country, slug, brand_colors, logo_url'
    )
    .eq('user_id', user.id)
    .maybeSingle();
  if (lookup.error)
    throw new Error('Could not load your store setup. Please try again.');
  const existing = lookup.data;
  if (existing?.business_name) {
    return {
      status: 'completed',
      businessName: existing.business_name,
      businessType:
        existing.business_type?.trim() || LEGACY_COMPLETED_BUSINESS_TYPE,
      merchant: existing,
    };
  }

  let merchant: OnboardingMerchant | null;
  const useCustomSlug = Boolean(slugIsCustom && requestedSlug?.trim());
  if (existing) {
    const resolvedSlug = useCustomSlug
      ? requestedSlug?.trim()
      : hasEstablishedOnboardingSlug(existing.slug)
        ? null
        : await resolveOnboardingMerchantSlug(supabase, businessName);
    const { data, error } = await merchants
      .update({
        email,
        business_name: businessName,
        business_type: finalBusinessType,
        country,
        payout_currency: payoutCurrency,
        logo_url: normalizedLogoUrl,
        favicon_png_192_url: normalizedLogoUrl,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        ...(brandColorsParsed ? { brand_colors: brandColors } : {}),
        ...(resolvedSlug ? { slug: resolvedSlug } : {}),
      })
      .eq('id', existing.id)
      .eq('user_id', user.id)
      .select('id, slug, brand_colors, hero_image_ids, logo_url')
      .single();
    if (error) {
      if (isSlugUniqueViolation(error)) {
        throw new OnboardingSlugUnavailableError();
      }
      throw new Error(`Failed to update merchant: ${error.message}`);
    }
    merchant = data;
  } else {
    const slug = useCustomSlug
      ? (requestedSlug?.trim() ??
        (await resolveOnboardingMerchantSlug(supabase, businessName)))
      : await resolveOnboardingMerchantSlug(supabase, businessName);
    const { data, error } = await merchants
      .insert({
        user_id: user.id,
        email,
        business_name: businessName,
        business_type: finalBusinessType,
        country,
        payout_currency: payoutCurrency,
        logo_url: normalizedLogoUrl,
        favicon_png_192_url: normalizedLogoUrl,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        ...(brandColorsParsed ? { brand_colors: brandColors } : {}),
        slug,
        template_id: 'puck',
        signup_source: 'web',
      })
      .select('id, slug, brand_colors, hero_image_ids, logo_url')
      .single();
    if (error) {
      if (isSlugUniqueViolation(error)) {
        throw new OnboardingSlugUnavailableError();
      }
      throw new Error(`Merchant creation failed: ${error.message}`);
    }
    merchant = data;
  }
  if (!merchant) throw new Error('Failed to create merchant record.');
  return {
    status: 'saved',
    businessName,
    businessType: finalBusinessType,
    merchant,
  };
}
