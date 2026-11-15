import { z } from 'zod';

export const incrementViewCountPostIdSchema = z.string().trim().min(1);

export const trackBlogPostViewSchema = z.object({
  slug: z.string().trim().min(1),
});
