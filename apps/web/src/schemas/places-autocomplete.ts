import { z } from 'zod';

export const placesAutocompleteSchema = z.object({
  fallback: z.literal('geoapify').optional(),
  input: z.string().trim().max(300, 'Address search is too long'),
  sessionToken: z.string().max(256, 'Invalid sessionToken format').optional(),
  country: z
    .string()
    .regex(/^[a-zA-Z]{2}$/, 'Invalid country format')
    .transform((value) => value.toLowerCase())
    .optional(),
});
