import z from 'zod';
import {
  PLATFORM_ANALYTICS_IDENTIFIER_MAX_LENGTH,
  PLATFORM_GA4_SECRET_MAX_LENGTH,
} from './constants';

const nullableIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(PLATFORM_ANALYTICS_IDENTIFIER_MAX_LENGTH)
  .nullable()
  .optional();
const nullableGa4SecretSchema = z
  .string()
  .min(1)
  .max(PLATFORM_GA4_SECRET_MAX_LENGTH)
  .nullable()
  .optional();
const nullableSecretSchema = z.string().min(1).max(4096).nullable().optional();
const nullableUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .nullable()
  .optional();
const percentageSchema = z
  .preprocess(
    (value) =>
      typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
    z.number().finite().min(0).max(100)
  )
  .optional();
const flatFeeSchema = z
  .preprocess(
    (value) =>
      typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
    z.number().finite().min(0).max(100_000_000)
  )
  .optional();

export const PlatformSettingsUpdateSchema = z.strictObject({
  google_analytics_id: nullableIdentifierSchema,
  ga4_api_secret: nullableGa4SecretSchema,
  facebook_pixel_id: nullableIdentifierSchema,
  facebook_capi_token: nullableSecretSchema,
  tiktok_pixel_id: nullableIdentifierSchema,
  tiktok_access_token: nullableSecretSchema,
  snapchat_pixel_id: nullableIdentifierSchema,
  snapchat_capi_token: nullableSecretSchema,
  twitter_pixel_id: nullableIdentifierSchema,
  platform_fee_percentage: percentageSchema,
  platform_fee_flat: flatFeeSchema,
  payment_processor_fee_percentage: percentageSchema,
  payment_processor_fee_flat: flatFeeSchema,
  platform_name: z.string().trim().min(1).max(100).optional(),
  platform_logo_url: nullableUrlSchema,
  support_email: z
    .string()
    .trim()
    .email('support_email must be a valid email address')
    .max(254)
    .nullable()
    .optional(),
  support_phone: z.string().trim().min(1).max(50).nullable().optional(),
  enable_merchant_signups: z.boolean().optional(),
  enable_custom_domains: z.boolean().optional(),
  enable_analytics_export: z.boolean().optional(),
  maintenance_mode: z.boolean().optional(),
  maintenance_message: z.string().trim().min(1).max(1000).nullable().optional(),
});

export const PlatformSettingsResponseSchema = z
  .strictObject({
    id: z.string().min(1),
    google_analytics_id: z.string().nullable(),
    facebook_pixel_id: z.string().nullable(),
    tiktok_pixel_id: z.string().nullable(),
    snapchat_pixel_id: z.string().nullable(),
    twitter_pixel_id: z.string().nullable(),
    platform_fee_percentage: z.number(),
    platform_fee_flat: z.number(),
    payment_processor_fee_percentage: z.number(),
    payment_processor_fee_flat: z.number(),
    platform_name: z.string(),
    platform_logo_url: z.string().nullable(),
    support_email: z.string().nullable(),
    support_phone: z.string().nullable(),
    enable_merchant_signups: z.boolean(),
    enable_custom_domains: z.boolean(),
    enable_analytics_export: z.boolean(),
    maintenance_mode: z.boolean(),
    maintenance_message: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    secretStatus: z.strictObject({
      ga4_api_secret: z.boolean(),
      facebook_capi_token: z.boolean(),
      tiktok_access_token: z.boolean(),
      snapchat_capi_token: z.boolean(),
    }),
  })
  .strict();

export type PlatformSettingsResponse = z.infer<
  typeof PlatformSettingsResponseSchema
>;
export type PlatformSettingsSecretStatus =
  PlatformSettingsResponse['secretStatus'];
