import { z } from 'zod';

export const platformBlogRouteParamsSchema = z.object({
  id: z.string().min(1),
});
