import { z } from 'zod';
export const productRequestSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .refine((value) => /[\p{L}\p{N}]/u.test(value), 'Enter a product name.'),
    contact: z
      .string()
      .trim()
      .min(5)
      .max(160)
      .refine(
        (value) =>
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
          /^\+?[\d ()-]{7,25}$/.test(value),
        'Enter an email address or phone number.'
      ),
    requestId: z.string().uuid(),
    merchantSlug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/),
  })
  .strict();
export type ProductRequest = z.infer<typeof productRequestSchema>;
export async function sendProductRequest(
  client: {
    rpc: (
      name: string,
      args: Record<string, string>
    ) => PromiseLike<{ error: unknown }>;
  },
  input: ProductRequest
): Promise<void> {
  const request = productRequestSchema.parse(input);
  const { error } = await client.rpc('submit_storefront_product_request', {
    p_query: request.query,
    p_contact: request.contact,
    p_request_id: request.requestId,
    p_merchant_slug: request.merchantSlug,
  });
  if (error) throw new Error('Couldn’t send your request. Please try again.');
}
