import { z } from 'zod';
import { RouteIdentifierSchema } from './route-identifier';

const STOREFRONT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Storefront routes receive either a merchant slug or a custom hostname.
const storeSlug = RouteIdentifierSchema;

const deviceSlug = z
  .string()
  .trim()
  .min(1, 'Device slug is required')
  .max(120, 'Device slug must be 120 characters or fewer')
  .regex(
    STOREFRONT_SLUG_REGEX,
    'Device slug must contain lowercase letters, numbers, and single hyphens'
  );

export const repairsDevicesRouteParamsSchema = z.object({
  slug: storeSlug,
});

export const repairsDeviceDetailRouteParamsSchema = z.object({
  slug: storeSlug,
  deviceSlug,
});

export const repairsDevicesQuerySchema = z.object({
  q: z.string().trim().max(100, 'Search query is too long').optional(),
  mode: z.enum(['catalog', 'suggestions']).default('catalog'),
});

export type RepairsDevicesRouteParams = z.infer<
  typeof repairsDevicesRouteParamsSchema
>;
export type RepairsDeviceDetailRouteParams = z.infer<
  typeof repairsDeviceDetailRouteParamsSchema
>;
export type RepairsDevicesQuery = z.infer<typeof repairsDevicesQuerySchema>;
