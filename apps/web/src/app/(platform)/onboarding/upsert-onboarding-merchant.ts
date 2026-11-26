import type { User } from '@supabase/supabase-js';
import { getCountryByCode } from '@/lib/countries';
import type { createClient as createServerClient } from '@/lib/supabase/server';
import { isReservedMerchantSlug } from '@/lib/validation';
import type {
  OnboardingBrandColors,
  OnboardingMerchant,
} from './onboarding-action-types';
import {
  extractRenamedSlugResult,
  hasEstablishedOnboardingSlug,
  isRenameSlugUnavailableError,
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

const SLUG_UNIQUE_ERROR_PATTERN =
  /idx_merchants_slug|merchants_slug_key|slug_is_reserved|slug_is_retired_alias|slug_too_long/i;
const SLUG_UNIQUE_DETAIL_PATTERN = /key\s*\(\s*slug\s*\)/i;

interface MerchantMutationError {
  code?: string;
  constraint?: string;
  details?: string | null;
  message: string;
}

function isSlugUniqueViolation(error: MerchantMutationError): boolean {
  if (error.code !== '23505') return false;
  if (
    error.constraint === 'idx_merchants_slug' ||
    error.constraint === 'merchants_slug_key'
  ) {
    return true;
  }
  return (
    SLUG_UNIQUE_ERROR_PATTERN.test(error.message) ||
    (typeof error.details === 'string' &&
      SLUG_UNIQUE_DETAIL_PATTERN.test(error.details))
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
      retiredSlug?: string | null;
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
              error: MerchantMutationError | null;
            }>;
          };
        };
      };
    };
    insert: (values: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{
          data: OnboardingMerchant | null;
          error: MerchantMutationError | null;
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
  let retiredSlug: string | null = null;
  const normalizedRequestedSlug =
    requestedSlug?.trim().toLowerCase() || undefined;
  const customSlug = slugIsCustom ? normalizedRequestedSlug : undefined;
  if (customSlug && isReservedMerchantSlug(customSlug)) {
    throw new OnboardingSlugUnavailableError();
  }
  if (existing) {
    const hasEstablishedSlug = hasEstablishedOnboardingSlug(existing.slug);
    const existingSlugNormalized = existing.slug?.trim().toLowerCase();
    const draftRenameTarget =
      hasEstablishedSlug &&
      normalizedRequestedSlug &&
      normalizedRequestedSlug !== existingSlugNormalized
        ? normalizedRequestedSlug
        : undefined;
    if (draftRenameTarget) {
      let targetSlug = draftRenameTarget;
      if (isReservedMerchantSlug(targetSlug)) {
        if (slugIsCustom) {
          throw new OnboardingSlugUnavailableError();
        }
        targetSlug = await resolveOnboardingMerchantSlug(
          supabase,
          businessName
        );
      }
      // prevent_established_merchant_slug_change() rejects direct UPDATEs on a
      // non-empty slug; route draft-merchant slug changes through the RPC.
      let renameAttempt = await supabase.rpc('rename_merchant_slug', {
        p_merchant_id: existing.id,
        p_new_slug: targetSlug,
      });
      if (
        renameAttempt.error &&
        !slugIsCustom &&
        isRenameSlugUnavailableError(renameAttempt.error)
      ) {
        targetSlug = await resolveOnboardingMerchantSlug(
          supabase,
          businessName
        );
        renameAttempt = await supabase.rpc('rename_merchant_slug', {
          p_merchant_id: existing.id,
          p_new_slug: targetSlug,
        });
      }
      if (renameAttempt.error) {
        if (isRenameSlugUnavailableError(renameAttempt.error)) {
          throw new OnboardingSlugUnavailableError();
        }
        throw new Error(
          `Failed to update merchant slug: ${renameAttempt.error.message}`
        );
      }
      retiredSlug = extractRenamedSlugResult(
        renameAttempt.data,
        targetSlug,
        existing.slug
      ).retiredSlug;
    }
    const resolvedSlug = hasEstablishedSlug
      ? null
      : (customSlug ??
        (await resolveOnboardingMerchantSlug(supabase, businessName)));
    const { data, error } = await merchants
      .update({
        email,
        business_name: businessName,
        business_type: finalBusinessType,
        country,
        payout_currency: payoutCurrency,
        logo_url: normalizedLogoUrl,
        favicon_png_192_url: normalizedLogoUrl,
        ...(phone !== undefined ? { phone: normalizedPhone ?? null } : {}),
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
    const slug =
      customSlug ??
      (await resolveOnboardingMerchantSlug(supabase, businessName));
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
    ...(retiredSlug ? { retiredSlug } : {}),
  };
}
