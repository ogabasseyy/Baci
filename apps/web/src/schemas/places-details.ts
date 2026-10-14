import { z } from 'zod';

export const placesDetailsSchema = z.object({
  // Raw bound: the route strips an optional 'places/' prefix (7 chars)
  // before enforcing the 4000-char opaque-ID limit, so 4007 preserves it.
  placeId: z
    .string({ error: 'placeId is required' })
    .min(1, 'placeId is required')
    .max(4007, 'Invalid placeId format'),
  sessionToken: z.string().max(256, 'Invalid sessionToken format').optional(),
});
