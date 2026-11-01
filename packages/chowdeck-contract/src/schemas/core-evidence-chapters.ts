import { z } from 'zod';
import { wholeSecondTimestampSchema } from './whole-second-timestamp';

const status = z.enum(['documented', 'unproven']);
const unknown = z.literal('unproven');
const common = {
  version: z.literal(1),
  capturedAt: wholeSecondTimestampSchema,
  publicContractDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
};
export const coreEvidenceChapterSchema = z.discriminatedUnion('chapter', [
  z.strictObject({
    ...common,
    chapter: z.literal('0A-core/account-read'),
    claims: z.strictObject({
      authenticationScheme: status,
      endpoint: status,
      responseEnvelope: unknown,
      domainField: unknown,
      vendorIdField: unknown,
      currencyField: unknown,
      multipleProfileSelection: unknown,
    }),
    activation: z.literal('disabled'),
    blockerCode: z.literal('provider_response_schema_unproven'),
  }),
  z.strictObject({
    ...common,
    chapter: z.literal('0A-core/menu-groups-items'),
    claims: z.strictObject({
      categoryListEndpoint: status,
      menuListEndpoint: status,
      exactItemEndpoint: status,
      menuGroupReadEndpoint: unknown,
      responseEnvelopes: unknown,
      categoryFields: unknown,
      itemFields: unknown,
      groupFields: unknown,
      listCompleteness: unknown,
      missingItemSemantics: unknown,
    }),
    catalogRead: z.literal('disabled'),
    catalogWrite: z.literal('disabled'),
  }),
  z.strictObject({
    ...common,
    chapter: z.literal('0A-core/error-pagination-limits'),
    claims: z.strictObject({
      stableProviderErrorCodes: unknown,
      absenceSemantics: unknown,
      pagination: unknown,
      cursorSemantics: unknown,
      listOrdering: unknown,
      requestLimit: unknown,
      responseLimit: unknown,
      rateLimit: unknown,
      retryGuidance: unknown,
    }),
    runtimeErrorProjection: z.literal('local_stable_codes_only'),
    activation: z.literal('disabled'),
  }),
]);
