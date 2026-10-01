import { NextResponse } from 'next/server';

export function createBuilderAiProviderErrorResponse(
  error: unknown,
  requestId: string
): Response {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === 'ai_builder_invalid_output') {
    return NextResponse.json(
      { code, error: 'AI editor returned an invalid draft', requestId },
      { status: 502 }
    );
  }
  if (code === 'ai_provider_rate_limited') {
    return NextResponse.json(
      {
        code,
        details:
          'AI editing is rate limited right now. Please try again later.',
        error: 'AI editor quota is temporarily exhausted',
        requestId,
      },
      { status: 429 }
    );
  }
  return NextResponse.json(
    {
      code: 'ai_provider_unavailable',
      error: 'AI editor is temporarily unavailable',
      requestId,
    },
    { status: 503 }
  );
}
