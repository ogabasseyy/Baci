import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readAgenticMutationRequest,
  readAgenticQueryRequest,
} from '@/lib/agentic/mutation-request';
import { verifyAgenticRequestIntegrity } from '@/lib/agentic/request-integrity';

vi.mock('@/lib/agentic/request-integrity', () => ({
  AGENTIC_REQUEST_INTEGRITY_ERRORS: {
    AGENT_ID_TOO_LONG: 'Agent id too long',
    INVALID_REQUEST_ID_FORMAT: 'Invalid request ID format',
    INVALID_AGENT_ID_FORMAT: 'Invalid agent id format',
    INVALID_TIMESTAMP: 'Invalid timestamp',
    MISSING_SIGNING_SECRET: 'Missing signing secret',
    REQUEST_ID_TOO_LONG: 'Request ID too long',
    STALE_TIMESTAMP: 'Stale timestamp',
    UNSUPPORTED_API_VERSION: 'Unsupported api version',
  },
  getAgenticSigningSecrets: vi.fn(() => ['signing-secret']),
  verifyAgenticRequestIntegrity: vi.fn(),
}));

function request(
  body: string,
  {
    headers = {},
    includeIdempotency = true,
  }: { headers?: Record<string, string>; includeIdempotency?: boolean } = {}
) {
  return new NextRequest('http://localhost/api/agentic/checkout_sessions', {
    body,
    headers: {
      ...(includeIdempotency ? { 'idempotency-key': 'idem-1' } : {}),
      ...headers,
    },
    method: 'POST',
  });
}

function getRequest() {
  return new NextRequest('http://localhost/api/agentic/orders/order-1', {
    headers: { authorization: 'Bearer test' },
    method: 'GET',
  });
}

describe('readAgenticMutationRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAgenticRequestIntegrity).mockReturnValue({
      agentId: null,
      apiVersion: '2026-04-30',
      ok: true,
      requestId: 'req_123',
    });
  });

  it('parses signed JSON mutation requests', async () => {
    const result = await readAgenticMutationRequest({
      request: request('{"items":[]}'),
    });

    expect(result).toMatchObject({
      apiVersion: '2026-04-30',
      agentId: null,
      body: { items: [] },
      idempotencyKey: 'idem-1',
      method: 'POST',
      ok: true,
      pathname: '/api/agentic/checkout_sessions',
      rawBody: '{"items":[]}',
      requestId: 'req_123',
    });
  });

  it('propagates signed agent identity from request integrity', async () => {
    vi.mocked(verifyAgenticRequestIntegrity).mockReturnValueOnce({
      agentId: 'openai:chatgpt',
      apiVersion: '2026-04-30',
      ok: true,
      requestId: 'req_123',
    });

    const result = await readAgenticMutationRequest({
      request: request('{"items":[]}'),
    });

    expect(result).toMatchObject({
      agentId: 'openai:chatgpt',
      ok: true,
    });
  });

  it('trims the idempotency key before reservation use', async () => {
    const result = await readAgenticMutationRequest({
      request: request('{"items":[]}', {
        headers: { 'idempotency-key': '  idem-1  ' },
      }),
    });

    expect(result).toMatchObject({
      idempotencyKey: 'idem-1',
      ok: true,
    });
  });

  it('uses an empty object for signed empty request bodies', async () => {
    const result = await readAgenticMutationRequest({ request: request('') });

    expect(result).toMatchObject({ body: {}, ok: true });
  });

  it('reads signed GET query requests without a request body or idempotency key', async () => {
    const result = await readAgenticQueryRequest({ request: getRequest() });

    expect(result).toMatchObject({
      body: {},
      idempotencyKey: '',
      method: 'GET',
      ok: true,
      pathname: '/api/agentic/orders/order-1',
      rawBody: '',
    });
    expect(verifyAgenticRequestIntegrity).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '',
        method: 'GET',
        pathname: '/api/agentic/orders/order-1',
      })
    );
  });

  it('reads signed POST catalog queries without an idempotency key', async () => {
    const result = await readAgenticQueryRequest({
      request: request('{"query":"iphone"}', { includeIdempotency: false }),
    });

    expect(result).toMatchObject({
      body: { query: 'iphone' },
      idempotencyKey: '',
      method: 'POST',
      ok: true,
    });
  });

  it('rejects missing required idempotency keys', async () => {
    const result = await readAgenticMutationRequest({
      request: request('{}', { includeIdempotency: false }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toEqual({
        error: 'Missing idempotency key',
      });
    }
  });

  it('rejects whitespace-only required idempotency keys', async () => {
    const result = await readAgenticMutationRequest({
      request: request('{}', { headers: { 'idempotency-key': '   ' } }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toEqual({
        error: 'Missing idempotency key',
      });
    }
  });

  it('maps integrity failures to API errors', async () => {
    vi.mocked(verifyAgenticRequestIntegrity).mockReturnValueOnce({
      error: 'Missing signing secret',
      ok: false,
    });

    const missingSecret = await readAgenticMutationRequest({
      request: request('{}'),
    });

    expect(missingSecret.ok).toBe(false);
    if (!missingSecret.ok) {
      expect(missingSecret.response.status).toBe(503);
    }

    vi.mocked(verifyAgenticRequestIntegrity).mockReturnValueOnce({
      error: 'Invalid signature',
      ok: false,
    });

    const invalidSignature = await readAgenticMutationRequest({
      request: request('{}'),
    });

    expect(invalidSignature.ok).toBe(false);
    if (!invalidSignature.ok) {
      expect(invalidSignature.response.status).toBe(401);
    }
  });

  it('returns 400 for malformed signed request metadata', async () => {
    vi.mocked(verifyAgenticRequestIntegrity).mockReturnValueOnce({
      error: 'Invalid request ID format',
      ok: false,
    });

    const result = await readAgenticMutationRequest({
      request: request('{}'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toEqual({
        error: 'Invalid request ID format',
      });
    }
  });

  it('rejects malformed JSON after integrity succeeds', async () => {
    const result = await readAgenticMutationRequest({
      request: request('{bad json'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toEqual({
        error: 'Invalid JSON body',
      });
    }
  });
});
