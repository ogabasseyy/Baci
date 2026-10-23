import { cookies } from 'next/headers';
import {
  getAppUrl,
  getConfiguredAppUrl,
  getRootDomain,
  isProduction,
} from '@/env';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { logger } from '@/lib/logger';
import { normalizeBusinessName } from '@/lib/normalize-business-name';
import { DEFAULT_CURATED_BRAND_COLORS } from '@/lib/storefront-defaults/default-curated-brand-colors';
import { provisionCuratedHomepage } from '@/lib/storefront-defaults/provision-curated-homepage';
import { createClient } from '@/lib/supabase/server';
import { parseBrandColors } from '@/schemas/brand-colors';
import { onboardingSchema } from '@/schemas/onboarding';
import type { BrandColors } from '@/types';
import { ensureOnboardingDomain } from './ensure-onboarding-domain';
import type {
  OnboardingBrandColors,
  ServerActionState,
} from './onboarding-action-types';
import { resolveOnboardingUser } from './resolve-onboarding-user';
import { upsertOnboardingMerchant } from './upsert-onboarding-merchant';

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
    businessName: rawBusinessName,
    businessType,
    otherBusinessType,
    country,
    logoUrl,
    brandColors: rawBrandColors,
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
      return { success: false, message: userResolution.message };
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
    });
    const merchant = persisted.merchant;
    if (!merchant.slug)
      throw new Error('Could not finish store setup. Please try again.');
    const domain = await ensureOnboardingDomain({
      supabase,
      merchantId: merchant.id,
      slug: merchant.slug,
      rootDomain: getRootDomain() || 'usebaci.com',
    });
    if (domain.status === 'conflict' || domain.status === 'failed')
      throw new Error('Could not finish store setup. Please try again.');
    const homepage = await provisionCuratedHomepage({
      supabase,
      expectedOwnerUserId: userResolution.user.id,
      merchantId: merchant.id,
      merchantSlug: merchant.slug,
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
        persisted.status === 'completed'
          ? 'Welcome back! Redirecting to your dashboard...'
          : 'Store created!',
      businessName: persisted.businessName,
      merchantId: merchant.id,
    };
  } catch (error) {
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
