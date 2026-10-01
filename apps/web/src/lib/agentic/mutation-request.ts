import { type NextRequest, NextResponse } from 'next/server';
import {
  AGENTIC_REQUEST_INTEGRITY_ERRORS,
  getAgenticSigningSecrets,
  verifyAgenticRequestIntegrity,
} from '@/lib/agentic/request-integrity';

const BAD_INTEGRITY_REQUEST_ERRORS: ReadonlySet<string> = new Set([
  AGENTIC_REQUEST_INTEGRITY_ERRORS.AGENT_ID_TOO_LONG,
  AGENTIC_REQUEST_INTEGRITY_ERRORS.INVALID_AGENT_ID_FORMAT,
  AGENTIC_REQUEST_INTEGRITY_ERRORS.INVALID_REQUEST_ID_FORMAT,
  AGENTIC_REQUEST_INTEGRITY_ERRORS.INVALID_TIMESTAMP,
  AGENTIC_REQUEST_INTEGRITY_ERRORS.REQUEST_ID_TOO_LONG,
  AGENTIC_REQUEST_INTEGRITY_ERRORS.STALE_TIMESTAMP,
  AGENTIC_REQUEST_INTEGRITY_ERRORS.UNSUPPORTED_API_VERSION,
]);

export type AgenticMutationRequest =
  | {
      apiVersion: string;
      agentId: string | null;
      body: unknown;
      idempotencyKey: string;
      method: string;
      ok: true;
      pathname: string;
      rawBody: string;
      requestId: string;
    }
  | { ok: false; response: NextResponse };

export function readAgenticMutationRequest({
  requireIdempotency = true,
  request,
}: {
  requireIdempotency?: boolean;
  request: NextRequest;
}): Promise<AgenticMutationRequest> {
  return readAgenticSignedRequest({ request, requireIdempotency });
}

export function readAgenticQueryRequest({
  request,
}: {
  request: NextRequest;
}): Promise<AgenticMutationRequest> {
  // Non-mutating agentic operations, including POST-based UCP catalog queries,
  // retain signed request integrity without requiring an idempotency key.
  return readAgenticSignedRequest({ request, requireIdempotency: false });
}

export async function readAgenticSignedRequest({
  requireIdempotency = true,
  request,
}: {
  requireIdempotency?: boolean;
  request: NextRequest;
}): Promise<AgenticMutationRequest> {
  const rawBody = await request.text();
  const integrity = verifyAgenticRequestIntegrity({
    body: rawBody,
    headers: request.headers,
    method: request.method,
    pathname: request.nextUrl.pathname,
    secrets: getAgenticSigningSecrets(),
  });

  if (!integrity.ok) {
    return {
      ok: false,
      response: buildIntegrityErrorResponse(integrity.error),
    };
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
  if (requireIdempotency && !idempotencyKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Missing idempotency key' },
        { status: 400 }
      ),
    };
  }

  try {
    return {
      apiVersion: integrity.apiVersion,
      agentId: integrity.agentId ?? null,
      body: rawBody.length > 0 ? JSON.parse(rawBody) : {},
      idempotencyKey,
      method: request.method,
      ok: true,
      pathname: request.nextUrl.pathname,
      rawBody,
      requestId: integrity.requestId,
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      ),
    };
  }
}

function buildIntegrityErrorResponse(error: string) {
  if (error === AGENTIC_REQUEST_INTEGRITY_ERRORS.MISSING_SIGNING_SECRET) {
    return NextResponse.json(
      { error: 'Agentic request signing is not configured' },
      { status: 503 }
    );
  }

  const status =
    error.startsWith('Missing') || BAD_INTEGRITY_REQUEST_ERRORS.has(error)
      ? 400
      : 401;
  return NextResponse.json({ error }, { status });
}
