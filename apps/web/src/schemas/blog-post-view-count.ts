import { z } from 'zod';

export const incrementViewCountPostIdSchema = z.string().trim().min(1);

export const trackBlogPostViewSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9_-]+$/i, 'Invalid blog post slug'),
});
