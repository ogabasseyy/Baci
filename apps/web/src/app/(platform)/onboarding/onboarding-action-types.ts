import type { BrandColors } from '@/types';

export type ServerActionState = {
  message: string;
  success: boolean;
  code?: string;
  businessName?: string;
  merchantId?: string;
  errors?: { fieldErrors: Record<string, string[] | undefined> };
};

export interface OnboardingMerchant extends Record<string, unknown> {
  brand_colors?: unknown;
  hero_image_ids?: unknown;
  id: string;
  business_name?: string | null;
  business_type?: string | null;
  country?: string | null;
  logo_url?: string | null;
  slug?: string;
}

export type OnboardingBrandColors = BrandColors | null;
