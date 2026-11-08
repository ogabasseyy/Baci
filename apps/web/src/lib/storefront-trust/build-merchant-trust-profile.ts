import type { RegisteredAddress } from '@baci/shared';
import { normalizeGooglePlaceId } from '@/lib/google-place-id-normalization';
import { isSocialPlatform, normalizeSocialUrl } from '@/lib/social';
import type {
  MerchantTrustProfile,
  MerchantTrustProfileRouteLinks,
  MerchantTrustProfileSource,
} from './merchant-trust-profile-types';

function normalizeString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeNumber(value: number | null | undefined): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : undefined;
}

function buildDerivedLink(
  normalizedBaseUrl: string | undefined,
  path: string
): string {
  return normalizedBaseUrl ? `${normalizedBaseUrl}${path}` : path;
}

function hasMeaningfulContent(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value != null;
}

export function hasPublishableReturnsPolicy(
  trustProfile: Pick<MerchantTrustProfile, 'returnPolicy'>
): boolean {
  return Boolean(
    trustProfile.returnPolicy &&
      (hasMeaningfulContent(trustProfile.returnPolicy.summary) ||
        trustProfile.returnPolicy.windowDays != null ||
        trustProfile.returnPolicy.returnMethod ||
        trustProfile.returnPolicy.returnFees)
  );
}

export function hasPublishableShippingPolicy(
  trustProfile: Pick<MerchantTrustProfile, 'shippingPolicy'>
): boolean {
  return Boolean(
    trustProfile.shippingPolicy &&
      (hasMeaningfulContent(trustProfile.shippingPolicy.summary) ||
        (trustProfile.shippingPolicy.regions?.length ?? 0) > 0 ||
        trustProfile.shippingPolicy.handlingDaysMin != null ||
        trustProfile.shippingPolicy.handlingDaysMax != null ||
        trustProfile.shippingPolicy.transitDaysMin != null ||
        trustProfile.shippingPolicy.transitDaysMax != null ||
        trustProfile.shippingPolicy.shippingFeeType)
  );
}

export function hasPublishableWarrantyPolicy(
  trustProfile: Pick<MerchantTrustProfile, 'warrantyPolicy'>
): boolean {
  return Boolean(
    trustProfile.warrantyPolicy &&
      hasMeaningfulContent(trustProfile.warrantyPolicy.summary)
  );
}

function normalizeRegisteredAddress(
  address: RegisteredAddress | null | undefined
): RegisteredAddress | undefined {
  if (!address) {
    return undefined;
  }

  const normalized: RegisteredAddress = {
    street: normalizeString(address.street ?? undefined),
    city: normalizeString(address.city ?? undefined),
    state: normalizeString(address.state ?? undefined),
    postal_code: normalizeString(address.postal_code ?? undefined),
    country: normalizeString(address.country ?? undefined),
  };

  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function normalizeSocialLinks(
  socialMedia: MerchantTrustProfileSource['social_media']
): Record<string, string> {
  if (!socialMedia) {
    return {};
  }

  const normalized: Record<string, string> = {};

  for (const [platform, value] of Object.entries(socialMedia)) {
    const cleaned = normalizeString(value ?? undefined);
    if (!cleaned) {
      continue;
    }

    if (isSocialPlatform(platform)) {
      const normalizedUrl = normalizeSocialUrl(cleaned, platform);
      if (normalizedUrl) {
        normalized[platform] = normalizedUrl;
      }
      continue;
    }

    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      normalized[platform] = cleaned;
    }
  }

  return normalized;
}

function buildDerivedLinks(
  merchant: MerchantTrustProfileSource,
  normalizedBaseUrl: string | undefined,
  profile: MerchantTrustProfile
): MerchantTrustProfileRouteLinks {
  const derivedLinks: MerchantTrustProfileRouteLinks = {};
  const hasTemplatePolicyPages =
    !!merchant.template_id &&
    merchant.template_id !== 'default' &&
    merchant.template_id !== 'puck';

  if (hasMeaningfulContent(merchant.about_page)) {
    derivedLinks.about = buildDerivedLink(normalizedBaseUrl, '/about');
  }

  if (hasMeaningfulContent(merchant.pages?.contact)) {
    derivedLinks.contact = buildDerivedLink(normalizedBaseUrl, '/contact');
  }

  if (hasMeaningfulContent(merchant.pages?.privacy) || hasTemplatePolicyPages) {
    derivedLinks.privacy = buildDerivedLink(normalizedBaseUrl, '/privacy');
  }

  if (hasMeaningfulContent(merchant.pages?.terms) || hasTemplatePolicyPages) {
    derivedLinks.terms = buildDerivedLink(normalizedBaseUrl, '/terms');
  }

  if (hasMeaningfulContent(merchant.pages?.faq)) {
    derivedLinks.faq = buildDerivedLink(normalizedBaseUrl, '/faq');
  }

  if (hasPublishableReturnsPolicy(profile)) {
    derivedLinks.returns = buildDerivedLink(normalizedBaseUrl, '/returns');
  }

  if (hasPublishableShippingPolicy(profile)) {
    derivedLinks.shipping = buildDerivedLink(normalizedBaseUrl, '/shipping');
  }

  if (hasPublishableWarrantyPolicy(profile)) {
    derivedLinks.warranty = buildDerivedLink(normalizedBaseUrl, '/warranty');
  }

  return derivedLinks;
}

export function buildMerchantTrustProfile(
  merchant: MerchantTrustProfileSource,
  baseUrl?: string
): MerchantTrustProfile {
  const trustProfile = merchant.trust_profile ?? {};
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  const result: MerchantTrustProfile = {
    socialLinks: normalizeSocialLinks(merchant.social_media),
    derivedLinks: {},
  };

  result.supportEmail = normalizeString(merchant.support_email ?? undefined);
  result.supportPhone = normalizeString(merchant.support_phone ?? undefined);
  result.businessAddress = normalizeString(
    merchant.business_address ?? undefined
  );
  result.registeredAddress = normalizeRegisteredAddress(
    merchant.registered_address
  );
  result.legalEntityName = normalizeString(
    merchant.legal_entity_name ?? undefined
  );
  result.taxIdentificationNumber = normalizeString(
    merchant.tax_identification_number ?? undefined
  );
  result.foundedYear = normalizeNumber(trustProfile.founded_year);

  const customerService = trustProfile.customer_service;
  const whatsappNumber = normalizeString(customerService?.whatsapp_number);
  if (whatsappNumber) {
    result.whatsappNumber = whatsappNumber;
  }

  const customerServiceHours = {
    summary: normalizeString(customerService?.hours_summary),
    timezone: normalizeString(customerService?.timezone),
    responseTimeSummary: normalizeString(
      customerService?.response_time_summary
    ),
  };
  if (Object.values(customerServiceHours).some(Boolean)) {
    result.customerServiceHours = customerServiceHours;
  }

  const returnPolicyDraft = trustProfile.return_policy;
  const returnPolicy = {
    summary: normalizeString(returnPolicyDraft?.summary),
    windowDays: normalizeNumber(returnPolicyDraft?.window_days),
    returnMethod: returnPolicyDraft?.return_method ?? undefined,
    returnFees: returnPolicyDraft?.return_fees ?? undefined,
    localRoute: '/returns' as const,
  };
  if (
    returnPolicy.summary ||
    returnPolicy.windowDays != null ||
    returnPolicy.returnMethod ||
    returnPolicy.returnFees
  ) {
    result.returnPolicy = returnPolicy;
  }

  const shippingPolicyDraft = trustProfile.shipping_policy;
  const shippingPolicy = {
    summary: normalizeString(shippingPolicyDraft?.summary),
    regions: (shippingPolicyDraft?.regions ?? []).filter(
      (region): region is string =>
        typeof region === 'string' && region.length > 0
    ),
    handlingDaysMin: normalizeNumber(shippingPolicyDraft?.handling_days_min),
    handlingDaysMax: normalizeNumber(shippingPolicyDraft?.handling_days_max),
    transitDaysMin: normalizeNumber(shippingPolicyDraft?.transit_days_min),
    transitDaysMax: normalizeNumber(shippingPolicyDraft?.transit_days_max),
    shippingFeeType: shippingPolicyDraft?.shipping_fee_type ?? undefined,
    localRoute: '/shipping' as const,
  };
  if (
    shippingPolicy.summary ||
    shippingPolicy.regions.length > 0 ||
    shippingPolicy.handlingDaysMin != null ||
    shippingPolicy.handlingDaysMax != null ||
    shippingPolicy.transitDaysMin != null ||
    shippingPolicy.transitDaysMax != null ||
    shippingPolicy.shippingFeeType
  ) {
    result.shippingPolicy = shippingPolicy;
  }

  const warrantySummary = normalizeString(
    trustProfile.warranty_policy?.summary
  );
  if (warrantySummary) {
    result.warrantyPolicy = {
      summary: warrantySummary,
      localRoute: '/warranty',
    };
  }

  const googlePlaceId = merchant.feature_settings?.google_reviews_enabled
    ? normalizeGooglePlaceId(merchant.feature_settings.google_place_id)
    : undefined;
  if (googlePlaceId) {
    result.merchantReviewAuthority = {
      attributionLabel: 'Google Maps',
      placeId: googlePlaceId,
      reviewsSortedBy: 'relevance',
      source: 'google_maps',
    };
  }

  result.derivedLinks = buildDerivedLinks(merchant, normalizedBaseUrl, result);

  return result;
}
