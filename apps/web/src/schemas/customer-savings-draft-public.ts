import { z } from 'zod';
import {
  SavingsDeviceProductSchema,
  SavingsDeviceVariantSchema,
} from '@/lib/customer-savings-device';
import { customerSavingsDraftSchemas } from './customer-savings-draft';

const draft = z
  .strictObject({
    draftId: z.uuid(),
    requestId: z.uuid(),
    revisionId: z.uuid(),
    productId: z.uuid(),
    variantId: z.uuid().nullable(),
    status: z.literal('draft'),
    device: z.strictObject({
      name: z.string().trim().min(1),
      condition: z.string().trim().min(1),
      image: z.string().nullable(),
      price: z.number().finite().positive(),
      selectionStatus: z.literal('exact'),
      variantId: z.uuid().nullable(),
      variantLabel: z.string().nullable(),
    }),
    terms: customerSavingsDraftSchemas.record.shape.terms,
    consent: z.enum(['required', 'accepted']),
    createdAt: z.iso.datetime({ offset: true }),
    acceptedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine(
    (value) =>
      value.variantId === value.device.variantId &&
      (value.consent === 'accepted') === (value.acceptedAt !== null) &&
      (value.acceptedAt === null ||
        Date.parse(value.acceptedAt) >= Date.parse(value.createdAt))
  );

export const customerSavingsDraftPublic = {
  draft,
  result: z.strictObject({ draft }),
  list: z.strictObject({ drafts: z.array(draft).max(50) }),
  scope: z.strictObject({ merchantId: z.uuid(), userId: z.uuid() }),
  selection: z.strictObject({
    productId: z.uuid(),
    variantId: z.uuid().nullable(),
  }),
  catalogue: z
    .array(
      SavingsDeviceProductSchema.extend({
        id: z.uuid(),
        has_variants: z.boolean().nullable(),
      })
    )
    .max(20),
  catalogueVariants: z
    .array(
      SavingsDeviceVariantSchema.extend({ id: z.uuid(), product_id: z.uuid() })
    )
    .max(1000),
  catalogueQuery: z.strictObject({
    search: z.string().trim().max(100),
    page: z.number().int().min(0).max(500),
  }),
};
export type CustomerSavingsDraft = z.infer<typeof draft>;
export type CustomerSavingsDraftScope = z.infer<
  typeof customerSavingsDraftPublic.scope
>;
export type CustomerSavingsDraftSelection = z.infer<
  typeof customerSavingsDraftPublic.selection
>;
export type CustomerSavingsDraftProduct = z.infer<
  typeof customerSavingsDraftPublic.catalogue
>[number];
