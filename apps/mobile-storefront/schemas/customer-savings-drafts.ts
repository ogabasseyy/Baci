import { z } from 'zod';

export const savingsDraftSchema = z
  .object({
    draftId: z.uuid(),
    requestId: z.uuid(),
    revisionId: z.uuid(),
    productId: z.uuid(),
    variantId: z.uuid().nullable(),
    status: z.literal('draft'),
    device: z.object({
      name: z.string().min(1),
      condition: z.string().min(1),
      price: z.number().finite().positive(),
      image: z.string().nullable(),
      selectionStatus: z.literal('exact'),
      variantId: z.uuid().nullable(),
      variantLabel: z.string().nullable(),
    }),
    terms: z.object({
      version: z.string().min(1),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      text: z.string().min(1).max(32768),
    }),
    consent: z.enum(['required', 'accepted']),
    createdAt: z.iso.datetime({ offset: true }),
    acceptedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine(
    (draft) =>
      draft.variantId === draft.device.variantId &&
      (draft.consent === 'accepted') === (draft.acceptedAt !== null)
  );

export type SavingsDraft = z.infer<typeof savingsDraftSchema>;
