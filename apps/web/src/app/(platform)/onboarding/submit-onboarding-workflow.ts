import { cookies } from 'next/headers';
import {
  getAppUrl,
  getConfiguredAppUrl,
  getRootDomain,
  isProduction,
} from '@/env';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { invalidateMerchantSlugRename } from '@/lib/invalidate-merchant-slug-rename';
import { logger } from '@/lib/logger';
import { normalizeBusinessName } from '@/lib/normalize-business-name';
import { DEFAULT_CURATED_BRAND_COLORS } from '@/lib/storefront-defaults/default-curated-brand-colors';
import { provisionCuratedHomepage } from '@/lib/storefront-defaults/provision-curated-homepage';
import { createClient } from '@/lib/supabase/server';
import { isReservedMerchantSlug } from '@/lib/validation';
import { parseBrandColors } from '@/schemas/brand-colors';
import { onboardingSchema } from '@/schemas/onboarding';
import type { BrandColors } from '@/types';
import { ensureOnboardingDomain } from './ensure-onboarding-domain';
import type {
  OnboardingBrandColors,
  ServerActionState,
} from './onboarding-action-types';
import {
  extractRenamedSlugResult,
  isRenameSlugUnavailableError,
} from './onboarding-slug';
import { resolveOnboardingUser } from './resolve-onboarding-user';
import {
  OnboardingSlugUnavailableError,
  upsertOnboardingMerchant,
} from './upsert-onboarding-merchant';

export function buildOnboardingRedirectUrl(search = ''): string {
  const appUrl = getConfiguredAppUrl() ?? (isProduction() ? null : getAppUrl());
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL must be configured');
  const url = new URL('/onboarding', appUrl);
  url.search = search;
  return url.toString();
}
function parseOnboardingBrandColors(value?: string): {
  brandColors: OnboardingBrandColors;
  brandColorsParsed: boolean;
} {
  if (!value) return { brandColors: null, brandColorsParsed: false };
  try {
    const brandColors = parseBrandColors(JSON.parse(value));
    return { brandColors, brandColorsParsed: brandColors !== null };
  } catch (error) {
    logger.error({ message: 'Failed to parse brand colors', error });
    return { brandColors: null, brandColorsParsed: false };
  }
}
function resolveStarterBrandColors(
  parsed: OnboardingBrandColors,
  merchant: { brand_colors?: unknown } | null
): BrandColors {
  return (
    parsed ??
    parseBrandColors(merchant?.brand_colors) ??
    DEFAULT_CURATED_BRAND_COLORS
  );
}
export async function runSubmitOnboardingWorkflow(
  _prevState: ServerActionState,
  formData: FormData
): Promise<ServerActionState> {
  if (
    !(await ensureActionRateLimit('onboarding-submit', {
      requests: 5,
      windowMs: 900_000,
    }))
  )
    return {
      success: false,
      message: 'Too many onboarding attempts. Please try again later.',
    };
  const supabase = createClient(await cookies());
  const validationResult = await onboardingSchema.safeParseAsync(
    Object.fromEntries(formData.entries())
  );
  if (!validationResult.success)
    return {
      success: false,
      message: `Form is incomplete: ${validationResult.error.issues.map((issue) => issue.message).join(', ')}`,
      errors: validationResult.error.flatten(),
    };
  const {
    email,
    password,
    firstName,
    lastName,
    businessName: rawBusinessName,
    businessType,
    otherBusinessType,
    country,
    logoUrl,
    brandColors: rawBrandColors,
    phone,
    slug,
    slugIsCustom,
  } = validationResult.data;
  const businessName = normalizeBusinessName(rawBusinessName);
  const { brandColors, brandColorsParsed } =
    parseOnboardingBrandColors(rawBrandColors);
  try {
    const userResolution = await resolveOnboardingUser({
      supabase,
      email,
      password,
      redirectUrl: buildOnboardingRedirectUrl(),
      businessName,
      // Merchant enrollment is database-owned; never send before provisioning.
      onNewSession: () => undefined,
    });
    if (userResolution.status === 'message')
      return {
        success: false,
        code: 'auth_required',
        message: userResolution.message,
      };
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (
      (firstName || lastName) &&
      typeof supabase.auth?.updateUser === 'function'
    ) {
      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
          ...(fullName ? { full_name: fullName } : {}),
        },
      });
      if (metadataError) {
        logger.warn({
          message: 'Failed to persist onboarding owner name metadata',
          userId: userResolution.user.id,
          error: metadataError,
        });
      }
    }
    const persisted = await upsertOnboardingMerchant({
      supabase,
      user: userResolution.user,
      email,
      businessName,
      businessType,
      otherBusinessType,
      country,
      logoUrl,
      brandColors,
      brandColorsParsed,
      phone,
      slug,
      slugIsCustom,
    });
    const merchant = persisted.merchant;
    if (!merchant.slug)
      throw new Error('Could not finish store setup. Please try again.');
    let merchantSlug = merchant.slug;
    const rootDomain = getRootDomain() || 'usebaci.com';
    let recoveredFromDomainConflict = false;
    let domain = await ensureOnboardingDomain({
      supabase,
      merchantId: merchant.id,
      slug: merchantSlug,
      rootDomain,
    });
    const candidateSlug = slugIsCustom ? slug?.trim().toLowerCase() : undefined;
    // Only rename a completed merchant when its persisted slug failed at the
    // domain stage (conflict). Never silently rename an already-live store
    // whose domain already exists while other onboarding edits are ignored.
    if (
      domain.status === 'conflict' &&
      persisted.status === 'completed' &&
      candidateSlug &&
      candidateSlug !== merchantSlug.toLowerCase()
    ) {
      if (isReservedMerchantSlug(candidateSlug)) {
        throw new OnboardingSlugUnavailableError();
      }
      const { data: renameData, error: renameError } = await supabase.rpc(
        'rename_merchant_slug',
        {
          p_merchant_id: merchant.id,
          p_new_slug: candidateSlug,
        }
      );
      if (renameError) {
        if (isRenameSlugUnavailableError(renameError)) {
          throw new OnboardingSlugUnavailableError();
        }
        throw new Error(
          `Failed to update merchant slug: ${renameError.message}`
        );
      }
      const { finalSlug, retiredSlug } = extractRenamedSlugResult(
        renameData,
        candidateSlug,
        merchantSlug
      );
      // Always invalidate caches for the committed rename, and intentionally
      // keep finalSlug rather than rolling back to the known-conflicted old
      // slug (which would also burn finalSlug as a retired alias in the RPC).
      invalidateMerchantSlugRename({
        merchantId: merchant.id,
        finalSlug,
        retiredSlug,
      });
      merchantSlug = finalSlug;
      recoveredFromDomainConflict = true;
      domain = await ensureOnboardingDomain({
        supabase,
        merchantId: merchant.id,
        slug: merchantSlug,
        rootDomain,
      });
    }
    if (domain.status === 'conflict') {
      throw new OnboardingSlugUnavailableError();
    }
    if (domain.status === 'failed')
      throw new Error('Could not finish store setup. Please try again.');
    const homepage = await provisionCuratedHomepage({
      supabase,
      expectedOwnerUserId: userResolution.user.id,
      merchantId: merchant.id,
      merchantSlug,
      merchantLogoUrl: merchant.logo_url,
      businessName: persisted.businessName,
      businessType: persisted.businessType,
      brandColors: resolveStarterBrandColors(
        persisted.status === 'completed' ? null : brandColors,
        merchant
      ),
    });
    if (homepage.status === 'failed') {
      const error = new Error(
        `Canonical homepage provisioning failed at ${homepage.stage}`
      );
      logger.error({
        message: 'Template generation failed',
        merchantId: merchant.id,
        error,
      });
      throw error;
    }
    return {
      success: true,
      message:
        persisted.status === 'completed' && !recoveredFromDomainConflict
          ? 'Welcome back! Redirecting to your dashboard...'
          : 'Store created!',
      businessName: persisted.businessName,
      merchantId: merchant.id,
      merchantSlug,
    };
  } catch (error) {
    if (error instanceof OnboardingSlugUnavailableError) {
      return {
        success: false,
        code: 'slug_unavailable',
        message: error.message,
      };
    }
    logger.error({
      message: 'Onboarding setup failed',
      stage: 'setup',
      error,
    });
    return {
      success: false,
      message: 'Could not finish store setup. Please try again.',
    };
  }
}
