import { z } from 'zod';

export const geoapifyAutocompleteResultSchema = z.object({
  place_id: z.string().min(1),
  formatted: z.string().min(1),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  housenumber: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  town: z.string().optional(),
  village: z.string().optional(),
  county: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  country_code: z.string().optional(),
  postcode: z.string().optional(),
  result_type: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  rank: z
    .object({
      confidence_street_level: z.number().min(0).max(1).optional(),
      confidence_building_level: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

// Results stay unknown at the envelope level: one malformed provider
// result must not discard the whole batch. Each entry is validated
// individually and invalid entries are dropped like the Google path.
export const geoapifyAutocompleteResponseSchema = z.object({
  results: z.array(z.unknown()),
});
