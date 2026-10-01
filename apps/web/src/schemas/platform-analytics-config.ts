import { z } from 'zod';

const publicAnalyticsIdSchema = z.string().trim().min(1).max(100).nullable();

export const platformAnalyticsConfigRowsSchema = z
  .array(
    z.object({
      facebook_pixel_id: publicAnalyticsIdSchema,
      google_analytics_id: publicAnalyticsIdSchema,
      snapchat_pixel_id: publicAnalyticsIdSchema,
      tiktok_pixel_id: publicAnalyticsIdSchema,
      twitter_pixel_id: publicAnalyticsIdSchema,
    })
  )
  .max(1);

export type PlatformAnalyticsConfig = z.infer<
  typeof platformAnalyticsConfigRowsSchema
>[number];
