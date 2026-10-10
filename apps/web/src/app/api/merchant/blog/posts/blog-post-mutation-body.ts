import type { NextRequest } from 'next/server';

export async function parseBlogPostMutationBody(
  request: NextRequest
): Promise<
  | { body: Record<string, unknown>; error: null }
  | { body: null; error: 'Invalid JSON body' }
> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { body: null, error: 'Invalid JSON body' };
    }

    // Intent taxonomy is platform-editorial: strip it from merchant
    // mutation bodies so PATCH cannot persist via its validated-data
    // spread what CREATE omits from insertData.
    const {
      intent: _platformIntent,
      intent_source: _platformIntentSource,
      ...merchantBody
    } = body as Record<string, unknown>;
    return { body: merchantBody, error: null };
  } catch {
    return { body: null, error: 'Invalid JSON body' };
  }
}
