import type {
  MerchantTrustProfileDraft,
  MerchantTrustProfileReturnFee,
  MerchantTrustProfileReturnMethod,
  MerchantTrustProfileShippingFeeType,
  RegisteredAddress,
} from '@baci/shared';

export type {
  MerchantTrustProfileReturnFee,
  MerchantTrustProfileReturnMethod,
  MerchantTrustProfileShippingFeeType,
} from '@baci/shared';

export interface MerchantTrustProfileRouteLinks {
  about?: string;
  contact?: string;
  privacy?: string;
  terms?: string;
  faq?: string;
  returns?: string;
  shipping?: string;
  warranty?: string;
}

export interface MerchantReviewAttribution {
  provider?: string;
  providerUri?: string;
}

export interface MerchantReviewAuthority {
  attributionLabel: 'Google Maps';
  attributions?: MerchantReviewAttribution[];
  businessName?: string;
  googleMapsUrl?: string;
  placeId: string;
  rating?: number;
  reviewsSortedBy: 'relevance';
  source: 'google_maps';
  totalReviews?: number;
}

export interface MerchantTrustProfile {
  supportEmail?: string;
  supportPhone?: string;
  whatsappNumber?: string;
  socialLinks: Record<string, string>;
  businessAddress?: string;
  registeredAddress?: RegisteredAddress;
  legalEntityName?: string;
  taxIdentificationNumber?: string;
  foundedYear?: number;
  customerServiceHours?: {
    summary?: string;
    timezone?: string;
    responseTimeSummary?: string;
  };
  returnPolicy?: {
    summary?: string;
    windowDays?: number;
    returnMethod?: MerchantTrustProfileReturnMethod;
    returnFees?: MerchantTrustProfileReturnFee;
    localRoute: '/returns';
  };
  shippingPolicy?: {
    summary?: string;
    regions: string[];
    handlingDaysMin?: number;
    handlingDaysMax?: number;
    transitDaysMin?: number;
    transitDaysMax?: number;
    shippingFeeType?: MerchantTrustProfileShippingFeeType;
    localRoute: '/shipping';
  };
  warrantyPolicy?: {
    summary?: string;
    localRoute: '/warranty';
  };
  merchantReviewAuthority?: MerchantReviewAuthority;
  derivedLinks: MerchantTrustProfileRouteLinks;
}

interface MerchantTrustProfileFeatureSettings {
  [key: string]: unknown;
  google_reviews_enabled?: boolean | null;
  google_place_id?: string | null;
}

export interface MerchantTrustProfileSource {
  template_id?: string | null;
  support_email?: string | null;
  support_phone?: string | null;
  social_media?: Record<string, string | undefined> | null;
  business_address?: string | null;
  registered_address?: RegisteredAddress | null;
  legal_entity_name?: string | null;
  tax_identification_number?: string | null;
  about_page?: unknown;
  pages?: {
    about?: string | null;
    contact?: string | null;
    privacy?: string | null;
    terms?: string | null;
    faq?: string | null;
  } | null;
  trust_profile?: MerchantTrustProfileDraft | null;
  feature_settings?: MerchantTrustProfileFeatureSettings | null;
}
