import { z } from 'zod';

const sourceVersion = z.string().regex(/^[0-9a-f]{64}$/);
const canonicalUuid = z
  .uuid()
  .refine((value) => value === value.toLowerCase(), 'Expected canonical UUID.');
const draftItemSchema = z.object({
  id: canonicalUuid,
  ordinal: z.number().int().positive(),
  available: z.boolean(),
  capturedSourceVersion: sourceVersion,
  currentSourceVersion: sourceVersion.nullable(),
});

// Bound client-side collection independently of untrusted response metadata.
export const jumiaGamingDraftPageSchema = z
  .object({
    selectionId: canonicalUuid,
    sourceCategoryId: canonicalUuid,
    total: z.number().int().min(0).max(100_000),
    page: z.number().int().min(1).max(1_000),
    limit: z.number().int().min(1).max(100),
    totalPages: z.number().int().min(0).max(1_000),
    products: z.array(draftItemSchema).max(100),
  })
  .superRefine((page, context) => {
    const expectedPages = Math.ceil(page.total / page.limit);
    const start = (page.page - 1) * page.limit;
    const expectedLength = Math.min(
      page.limit,
      Math.max(0, page.total - start)
    );
    if (
      page.totalPages !== expectedPages ||
      page.page > Math.max(1, expectedPages) ||
      page.products.length !== expectedLength
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent frozen pagination.',
      });
    }
    const ids = new Set<string>();
    page.products.forEach((item, index) => {
      if (ids.has(item.id) || item.ordinal !== start + index + 1) {
        context.addIssue({
          code: 'custom',
          message: 'Invalid frozen membership.',
        });
      }
      ids.add(item.id);
    });
  });

export type JumiaGamingDraftProduct = {
  id: string;
  sourceCategoryId: string;
  capturedSourceVersion: string;
};

export type JumiaGamingDraftPage = z.infer<typeof jumiaGamingDraftPageSchema>;
