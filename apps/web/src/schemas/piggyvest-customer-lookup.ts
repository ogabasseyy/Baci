import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

/** Our third_party_identifier for a PiggyVest customer (bounded, non-empty). */
export const piggyvestThirdPartyIdentifierSchema = z.string().min(1).max(200);

/**
 * GET /api/v1/customers?third_party_identifier=… (proof p1, 2026-10-31: the
 * list sits under paginatedPayload.edges and echoes the identifier).
 */
export const piggyvestCustomerLookupSchema = z.object({
  paginatedPayload: z.object({
    edges: z
      .array(
        z.object({
          id: piggyvestProviderIdSchema,
          third_party_identifier: z.string().nullable().optional(),
        })
      )
      .max(20),
    pageInfo: z.object({ hasNextPage: z.boolean() }),
  }),
});
