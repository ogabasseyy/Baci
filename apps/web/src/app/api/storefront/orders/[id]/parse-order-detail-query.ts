import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export interface OrderDetailQuery {
  token?: string;
  email?: string;
  merchantSlug?: string;
}

/**
 * Parses the public order-detail query aliases (token/tracking_token,
 * merchant_slug/slug) and validates them. Returns the 400 response to
 * short-circuit with when validation fails.
 */
export function parseOrderDetailQuery(
  request: NextRequest
):
  | { ok: true; query: OrderDetailQuery }
  | { ok: false; response: NextResponse } {
  const { searchParams } = new URL(request.url);

  const token =
    searchParams.get('token') ||
    searchParams.get('tracking_token') ||
    undefined;
  const email = searchParams.get('email') || undefined;
  const merchantSlug =
    searchParams.get('merchant_slug') || searchParams.get('slug') || undefined;

  const parsed = z
    .object({
      token: z.string().min(1).optional(),
      email: z.email().optional(),
      merchant_slug: z.string().min(1).optional(),
    })
    .safeParse({ token, email, merchant_slug: merchantSlug });

  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid request', details: z.flattenError(parsed.error) },
        { status: 400 }
      ),
    };
  }
  return { ok: true, query: { token, email, merchantSlug } };
}
