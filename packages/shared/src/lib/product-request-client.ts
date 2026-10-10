import { type ProductRequest, productRequestSchema } from './product-request';

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
//
// Idempotency binds the payload: retries must resend the identical
// query/contact with the same requestId. Reusing an id with different
// content (even equivalent phone punctuation) returns 409; equivalent
// repeats under fresh ids are covered by the 24h canonical dedup.
export async function submitProductRequest(
  endpoint: string,
  input: ProductRequest,
  init?: { csrfToken?: string | null }
): Promise<void> {
  const request = productRequestSchema.parse(input);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Double-submit cookie name mirrors web's CSRF_HEADER_NAME; the
        // caller reads it from the cookie (shared must not import web).
        ...(init?.csrfToken ? { 'x-csrf-token': init.csrfToken } : {}),
      },
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
