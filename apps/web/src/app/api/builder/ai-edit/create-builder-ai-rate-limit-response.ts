import { NextResponse } from 'next/server';

export function createBuilderAiRateLimitResponse(
  mode: 'legacy' | 'v1',
  requestId: string
): Response {
  return NextResponse.json(
    {
      code: 'rate_limited',
      ...(mode === 'legacy'
        ? { details: 'Rate limit exceeded. Please try again later.' }
        : {}),
      error: 'Rate limit exceeded',
      requestId,
    },
    { headers: { 'X-RateLimit-Remaining': '0' }, status: 429 }
  );
}
