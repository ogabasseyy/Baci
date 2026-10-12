import { z } from 'zod';
import { SavingsDeviceProductSchema } from '@/lib/customer-savings-device';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const merchant = { merchantId: uuid };
const terms = z.strictObject({
  version: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  text: z
    .string()
    .min(1)
    .max(32768)
    .refine(
      (value) =>
        value.trim().length > 0 &&
        value.isWellFormed() &&
        new TextEncoder().encode(value).byteLength <= 32768
    ),
});
const record = z.strictObject({
  draftId: uuid,
  requestId: uuid,
  revisionId: uuid,
  productId: uuid,
  variantId: uuid.nullable(),
  catalogue: SavingsDeviceProductSchema,
  terms,
  createdAt: z.iso.datetime({ offset: true }),
  acceptedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const customerSavingsDraftSchemas = {
  create: z.strictObject({
    ...merchant,
    productId: uuid,
    variantId: uuid.nullable(),
    requestId: uuid,
  }),
  list: z.strictObject({ ...merchant, requestId: uuid.optional() }),
  catalogue: z.strictObject({
    ...merchant,
    search: z.string().trim().max(100),
    page: z.coerce.number().int().min(0).max(500),
  }),
  policy: z.strictObject({ ...merchant, draftId: uuid }),
  accept: z.strictObject({
    ...merchant,
    draftId: uuid,
    revisionId: uuid,
    termsVersion: terms.shape.version,
    termsHash: terms.shape.hash,
    accepted: z.literal(true),
  }),
  record,
  result: z.strictObject({ draft: record }),
  listResult: z.strictObject({ drafts: z.array(record).max(50) }),
};
