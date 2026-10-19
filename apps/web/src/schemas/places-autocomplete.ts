import { z } from 'zod';

export const placesAutocompleteSchema = z.object({
  // Lenient by design: only 'geoapify' triggers fallback, and unknown
  // values (typos, legacy client params) must not 400 the request.
  fallback: z.string().optional(),
  input: z.string().trim().max(300, 'Address search is too long'),
  sessionToken: z.string().max(256, 'Invalid sessionToken format').optional(),
  country: z
    .string()
    .regex(/^[a-zA-Z]{2}$/, 'Invalid country format')
    .transform((value) => value.toLowerCase())
    .optional(),
});
