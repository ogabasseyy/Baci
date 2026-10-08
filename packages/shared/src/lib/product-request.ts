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
          (/^\+?[\d ()-]{7,25}$/.test(value) &&
            value.replace(/\D/g, '').length >= 7),
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
export class ProductRequestSubmitError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
// Submits through POST /api/storefront/product-requests. The submit RPC is
// granted only to the storefront_intake role (service_role is revoked), so
// callers must never invoke it directly: the API route adds a trusted
// per-IP network gate in front of the DB budgets.
export async function submitProductRequest(
  endpoint: string,
  input: ProductRequest
): Promise<void> {
  const request = productRequestSchema.parse(input);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error('Couldn’t send your request. Please try again.');
  }
  if (response.ok) return;
  if (response.status === 429)
    throw new ProductRequestSubmitError(
      429,
      'Too many requests. Please try again later.'
    );
  if (response.status === 409)
    throw new ProductRequestSubmitError(
      409,
      'This request conflicts with an earlier submission. Please try again.'
    );
  throw new Error('Couldn’t send your request. Please try again.');
}
