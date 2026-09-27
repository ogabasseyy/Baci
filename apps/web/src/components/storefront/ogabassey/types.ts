// Migrated from temp-source/types.ts
import type React from 'react';
import type { ProductImageAltPayload } from '@baci/shared';

/**
 * Product condition enum - shared across the application
 */
import { normalizeCanonicalProductCondition } from '@baci/shared/lib';

export type ProductCondition = 'new' | 'used' | 'open_box' | 'refurbished';

/**
 * Product condition offer interface
 */
export interface ProductConditionOffer {
  id: string;
  condition: ProductCondition;
  price: string; // Formatted price string
  rawPrice: number; // Raw numeric price
  compare_at_price?: string;
  stock?: number;
  stock_quantity?: number;
  images?: string[];
  notes?: string;
  grade?: string;
}

export interface ProductRecommendation {
  name: string;
  price: string;
  reason: string;
  category: string;
}

export interface Category {
  id: string;
  name: string;
  slug?: string;
  parent_id?: string | null;
  merchant_id?: string;
  icon?: React.ReactNode;
  color?: string;
}

export interface Banner {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  bgColor: string;
  textColor: string;
  size: 'large' | 'small';
}

export interface ProductSpecItem {
  label: string;
  value: string;
}

export interface ProductSpecSection {
  category: string;
  items: ProductSpecItem[];
}

export interface Product {
  id: number | string;
  merchantId?: string; // For scoped searches (comparison)
  slug?: string;
  name: string;
  price: string;
  rawPrice?: number;
  image: string;
  image_alt?: string | null;
  image_payloads?: readonly ProductImageAltPayload[] | null;
  seo_alt_text?: string | null;
  description: string;
  rating?: number;
  category?: string; // Backward compatibility (TEXT column - deprecated)
  category_id?: string; // FK to categories table
  categories?: Category; // Joined category object (Supabase convention: singular)
  categorySlug?: string;
  condition?:
    | 'New'
    | 'Used'
    | 'Open Box'
    | 'New & Used'
    | 'New & Open Box'
    | 'Used & Open Box'
    | 'Multiple Conditions'
    | ProductCondition;
  // Detailed specs for filtering
  brand?: string;
  storage?: string | string[];
  ram?: string;
  colors?: string[] | { name: string; value: string }[];
  simType?: string;
  displayType?: string;
  displaySize?: string;
  graphics?: string;
  // New fields for Interactive Grid
  images?: string[];
  spec?: string;
  specs?: ProductSpecItem[];
  detailedSpecs?: ProductSpecSection[];
  reviews?: number;
  stock?: number;
  manage_stock?: boolean;
  videoUrl?: string; // YouTube URL for unboxing/review
  // Technical specs from API (optional but typed)
  product_key_specs?: ProductKeySpecs;
  // Phase 7: Condition Deduplication
  // Phase 7: Condition Deduplication
  has_condition_offers?: boolean;
  available_conditions?: ProductCondition[];
  offers?: ProductConditionOffer[];
  // Phase 4: Product Variants (Storage/Color/etc)
  has_variants?: boolean;
  variants?: ProductVariant[];
  variant_model?: string;
  variant_attributes?: Record<string, string[]>;
  /** Ordered list of variant dimension keys to render as selectors (e.g. ['storage', 'ram']) */
  attributeAxes?: string[];
}

export function normalizeProductCondition(
  condition: Product['condition'] | string | null | undefined
): ProductCondition | undefined {
  if (typeof condition !== 'string') {
    return undefined;
  }

  return normalizeCanonicalProductCondition(condition) || undefined;
}

export interface ProductVariant {
  id: string;
  name?: string;
  condition?: ProductCondition;
  price_override?: number;
  price_modifier?: number;
  primary_image?: string | null;
  stock?: number;
  stock_quantity?: number;
  images?: string[];
  attributes?: Record<string, string>;
}

export interface ProductKeySpecs {
  // Network
  network_technology?: string;
  has_5g?: boolean;
  has_nfc?: boolean;

  // Body
  dimensions_mm?: string;
  weight_g?: number;
  build_materials?: string;
  ip_rating?: string;
  sim_type?: string;

  // Display
  display_type?: string;
  screen_size_inches?: number;
  display_resolution?: string;
  refresh_rate_hz?: number;
  display_ppi?: number;
  display_peak_brightness?: number;

  // Platform
  android_version?: string;
  chipset?: string;
  cpu_cores?: string;
  gpu?: string;

  // Memory
  ram_gb?: number;
  storage_gb?: number;
  has_card_slot?: boolean;
  card_slot_type?: string;

  // Camera
  main_camera_mp?: number;
  has_quad_camera?: boolean;
  has_triple_camera?: boolean;
  has_dual_camera?: boolean;
  front_camera_mp?: number;
  rear_camera_video?: string;

  // Sound
  has_stereo_speakers?: boolean;
  has_headphone_jack?: boolean;

  // Connectivity
  wifi_bands?: string;
  bluetooth_version?: string;
  usb_type?: string;
  has_usb_otg?: boolean;
  has_fm_radio?: boolean;

  // Features
  fingerprint_type?: string;

  // Battery
  battery_mah?: number;
  charging_watt?: number;
  has_wireless_charging?: boolean;
  wireless_charging_watt?: number;

  // Allow index access for generic mapping
  [key: string]: string | number | boolean | string[] | undefined;
  recommended_for?: string[];
}

import type { CartItem } from '@/hooks/cart';

export type V2CartItem = CartItem;

export interface Order {
  id: string;
  date: string;
  time: string;
  total: string;
  status: string;
  paymentMethod: string;
  shippingAddress: string;
  items: V2CartItem[];
  walletDeduction?: number;
}

// Re-export specific types if needed by other components
export type { Product as V2Product };
