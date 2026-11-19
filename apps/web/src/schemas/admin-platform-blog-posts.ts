import { z } from 'zod';
import { createPlatformPostSchema } from '@/lib/validations/blog';

export const adminPlatformBlogPostsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
  offset: z.coerce.number().int().min(0).prefault(0),
});

export { createPlatformPostSchema };
