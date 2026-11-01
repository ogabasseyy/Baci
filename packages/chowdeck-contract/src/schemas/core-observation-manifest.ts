import { z } from 'zod';

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const blockerSchema = z.enum([
  'provider_response_schema_unproven',
  'pagination_semantics_unproven',
]);
const operationSchema = z
  .object({
    id: z.enum(['account_profile', 'category_list', 'menu_list', 'menu_item']),
    pathTemplate: z.enum([
      '/',
      '/{merchantReference}/menucategory',
      '/{merchantReference}/menu',
      '/{merchantReference}/menu/{menuReference}',
    ]),
    evidence: z.literal('documented'),
    enabled: z.literal(false),
    blockerCode: blockerSchema,
  })
  .strict();

const expectedOperations = [
  {
    id: 'account_profile',
    pathTemplate: '/',
    blockerCode: 'provider_response_schema_unproven',
  },
  {
    id: 'category_list',
    pathTemplate: '/{merchantReference}/menucategory',
    blockerCode: 'pagination_semantics_unproven',
  },
  {
    id: 'menu_list',
    pathTemplate: '/{merchantReference}/menu',
    blockerCode: 'pagination_semantics_unproven',
  },
  {
    id: 'menu_item',
    pathTemplate: '/{merchantReference}/menu/{menuReference}',
    blockerCode: 'provider_response_schema_unproven',
  },
] as const;

export const coreObservationManifestSchema = z
  .object({
    version: z.literal(1),
    baseUrl: z.literal('https://api.chowdeck.com/merchant'),
    publicContractDigest: digestSchema,
    readiness: z.literal('blocked_contract_evidence'),
    blockerCode: z.literal('provider_response_schema_unproven'),
    limits: z
      .object({
        maxRequests: z.literal(20),
        requestTimeoutMs: z.literal(10_000),
        totalTimeoutMs: z.literal(60_000),
        responseBytes: z.literal(1_048_576),
        totalBytes: z.literal(5_242_880),
        maxDepth: z.literal(32),
        maxNodes: z.literal(20_000),
      })
      .strict(),
    transport: z
      .object({
        method: z.literal('GET'),
        redirect: z.literal('error'),
        acceptEncoding: z.literal('identity'),
      })
      .strict(),
    operations: z.array(operationSchema).length(4),
  })
  .strict()
  .superRefine((manifest, context) => {
    const actual = manifest.operations.map(
      ({ id, pathTemplate, blockerCode }) => ({ id, pathTemplate, blockerCode })
    );
    if (JSON.stringify(actual) !== JSON.stringify(expectedOperations)) {
      context.addIssue({
        code: 'custom',
        message: 'Unexpected operation manifest',
        path: ['operations'],
      });
    }
  });

export type ChowdeckCoreObservationManifestV1 = z.infer<
  typeof coreObservationManifestSchema
>;
