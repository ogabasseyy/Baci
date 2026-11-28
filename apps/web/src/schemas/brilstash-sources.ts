import { z } from 'zod';
import {
  BRILSTASH_ON_DEMAND_CAPACITY,
  BRILSTASH_PILOT_LISTING_LIMIT,
} from '../config/brilstash-feed';

const revision = z.string().regex(/^\d+$/);
const sourceRow = z.strictObject({
  externalId: z.string().min(1),
  id: z.uuid(),
  parentProductId: z.uuid(),
  kind: z.enum(['product', 'variant', 'offer']),
  visible: z.boolean(),
  name: z.string().nullable(),
  slug: z.string().nullable(),
  brand: z.string().nullable(),
  condition: z.string().nullable(),
  parentCondition: z.string().nullable(),
  currency: z.string().nullable(),
  priceNaira: z.number().nullable(),
  partnerCategory: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  factsRevision: revision.nullable(),
  approvedFacts: z
    .strictObject({
      specifications: z.string(),
      boxContents: z.string(),
      warranty: z.string(),
    })
    .nullable(),
  verifiedImages: z.array(z.string()).max(10),
  inventory: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('quantity'),
      units: z.int().nullable(),
      legacyUnits: z.int().nullable(),
    }),
    z.strictObject({
      kind: z.literal('serialized'),
      units: z.int().nullable(),
    }),
    z.strictObject({ kind: z.literal('untracked') }),
    z.strictObject({
      kind: z.literal('on-demand'),
      units: z.literal(BRILSTASH_ON_DEMAND_CAPACITY),
    }),
    z.strictObject({
      kind: z.literal('withdrawn'),
      units: z.literal(0),
      approvalId: z.uuid(),
    }),
  ]),
});

export const brilStashSourcesSchema = z.strictObject({
  installationId: z.uuid(),
  merchantId: z.uuid(),
  catalogueRevision: revision,
  expectedActiveGenerationId: z.uuid().nullable(),
  sourceReadAt: z.iso.datetime({ offset: true }),
  rows: z.array(sourceRow).max(BRILSTASH_PILOT_LISTING_LIMIT),
  previousExternalIds: z.array(z.string()).max(BRILSTASH_PILOT_LISTING_LIMIT),
  retiredExternalIds: z.array(z.string()).max(BRILSTASH_PILOT_LISTING_LIMIT),
});
