import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jumiaOAuthExchangeSchema } from '@/schemas/jumia-oauth-exchange';

export async function parseJumiaOAuthExchangeRequest(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      success: false as const,
      response: NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      ),
    };
  }

  const parsed = jumiaOAuthExchangeSchema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false as const,
      response: NextResponse.json(
        { error: 'Invalid input', details: z.flattenError(parsed.error) },
        { status: 400 }
      ),
    };
  }

  return { success: true as const, data: parsed.data };
}
