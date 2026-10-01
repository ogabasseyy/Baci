import { NextRequest } from 'next/server';

export function getBuilderAiCsrfRequest(
  request: Request,
  authMode: 'bearer' | 'cookie' | undefined
): NextRequest {
  if (authMode !== 'cookie' || !request.headers.has('Authorization')) {
    return request as NextRequest;
  }
  return new NextRequest(request.url, {
    headers: new Headers(
      [...request.headers].filter(([name]) => name !== 'authorization')
    ),
    method: request.method,
  });
}
