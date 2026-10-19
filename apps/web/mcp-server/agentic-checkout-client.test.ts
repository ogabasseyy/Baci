import { createHmac } from 'node:crypto';
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import {
  AGENTIC_CHECKOUT_API_VERSION,
  AGENTIC_CHECKOUT_AGENT_ID,
  AGENTIC_CHECKOUT_USER_AGENT,
  cancelAgenticCheckoutSession,
  createAgenticCheckoutSessionMcpInputSchema,
  createAgenticCheckoutSession,
  getAgenticCheckoutSession,
  signAgenticRequest,
  updateAgenticCheckoutSessionMcpInputSchema,
  updateAgenticCheckoutSession,
} from './agentic-checkout-client';

async function listToolInputSchema(inputSchema: Record<string, z.ZodType>) {
  const server = new McpServer({ name: 'schema-test-server', version: '1.0.0' });
  const client = new Client({ name: 'schema-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  server.registerTool(
    'schema_probe',
    { inputSchema: z.object(inputSchema) },
    async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const result = await client.listTools();
    return result.tools.find((tool) => tool.name === 'schema_probe')
      ?.inputSchema;
  } finally {
    await client.close();
    await server.close();
  }
}

function expectRecord(value: unknown): Record<string, unknown> {
  expect(value).toEqual(expect.any(Object));
  return value as Record<string, unknown>;
}

describe('agentic checkout MCP input schemas', () => {
  it('advertises create checkout session fields to MCP clients', async () => {
    const schema = expectRecord(
      await listToolInputSchema(createAgenticCheckoutSessionMcpInputSchema)
    );
    const properties = expectRecord(schema.properties);

    expect(schema.required).toEqual(['items']);
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining([
        'currency',
        'idempotency_key',
        'items',
        'shipping_address',
      ])
    );

    const items = expectRecord(properties.items);
    const itemShape = expectRecord(expectRecord(items.items).properties);
    expect(items.type).toBe('array');
    expect(itemShape).toHaveProperty('id');
    expect(itemShape).toHaveProperty('quantity');
  });

  it('advertises update checkout session fields to MCP clients', async () => {
    const schema = expectRecord(
      await listToolInputSchema(updateAgenticCheckoutSessionMcpInputSchema)
    );
    const properties = expectRecord(schema.properties);

    expect(schema.required).toEqual(['session_id']);
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining([
        'fulfillment_option_id',
        'idempotency_key',
        'items',
        'session_id',
        'shipping_address',
      ])
    );

    const items = expectRecord(properties.items);
    const itemShape = expectRecord(expectRecord(items.items).properties);
    expect(items.type).toBe('array');
    expect(itemShape).toHaveProperty('id');
    expect(itemShape).toHaveProperty('quantity');
  });
});

describe('createAgenticCheckoutSession', () => {
  it('uses an OpenAI-identifying default user agent for checkout requests', () => {
    expect(AGENTIC_CHECKOUT_USER_AGENT.toLowerCase()).toContain('openai');
  });

  it('posts a signed request to the Baci agentic checkout session endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'agentic_session_1',
          status: 'not_ready_for_payment',
        }),
        { status: 201 }
      )
    );

    const result = await createAgenticCheckoutSession(
      {
        idempotency_key: 'idem-checkout-1',
        items: [{ id: 'product-1', quantity: 2 }],
      },
      {
        agentId: AGENTIC_CHECKOUT_AGENT_ID,
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        now: () => new Date('2026-05-21T12:00:00.000Z'),
        requestIdFactory: () => 'request-1',
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      endpoint: 'https://ogabassey.com/api/agentic/checkout_sessions',
      idempotencyKey: 'idem-checkout-1',
      ok: true,
      requestId: 'request-1',
      status: 201,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ogabassey.com/api/agentic/checkout_sessions');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({
        currency: 'NGN',
        items: [{ id: 'product-1', quantity: 2 }],
      })
    );
    expect(init.headers).toMatchObject({
      'agent-id': AGENTIC_CHECKOUT_AGENT_ID,
      'api-version': AGENTIC_CHECKOUT_API_VERSION,
      authorization: 'Bearer agentic-api-key',
      'content-type': 'application/json',
      'idempotency-key': 'idem-checkout-1',
      'request-id': 'request-1',
      timestamp: '2026-05-21T12:00:00.000Z',
      'user-agent': AGENTIC_CHECKOUT_USER_AGENT,
    });
    const headers = init.headers as Record<string, string>;
    const expectedSignature = createHmac('sha256', 'signing-secret')
      .update(
        JSON.stringify({
          api_version: AGENTIC_CHECKOUT_API_VERSION,
          body: init.body,
          idempotency_key: 'idem-checkout-1',
          method: 'POST',
          pathname: '/api/agentic/checkout_sessions',
          request_id: 'request-1',
          timestamp: '2026-05-21T12:00:00.000Z',
          agent_id: AGENTIC_CHECKOUT_AGENT_ID,
        })
      )
      .digest('hex');
    expect(headers.signature).toBe(expectedSignature);
  });

  it('fails closed when agentic checkout credentials are not configured', async () => {
    const fetchImpl = vi.fn();

    const result = await createAgenticCheckoutSession(
      { items: [{ id: 'product-1', quantity: 1 }] },
      {
        apiBaseUrl: 'https://ogabassey.com',
        fetchImpl,
      }
    );

    expect(result).toEqual({
      error: 'Agentic checkout credentials are not configured',
      ok: false,
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns route errors without exposing signing material', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );

    const result = await createAgenticCheckoutSession(
      { items: [{ id: 'product-1', quantity: 1 }] },
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        requestIdFactory: () => 'request-1',
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      error: 'Unauthorized',
      ok: false,
      status: 401,
    });
    expect(JSON.stringify(result)).not.toContain('signing-secret');
  });

  it('returns a structured failure when request preparation throws', async () => {
    const fetchImpl = vi.fn();

    const result = await createAgenticCheckoutSession(
      { items: [{ id: 'product-1', quantity: 1 }] },
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        requestIdFactory: () => {
          throw new Error('request id failed');
        },
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      error: 'request id failed',
      ok: false,
      status: 502,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('signing-secret');
  });
});

describe('getAgenticCheckoutSession', () => {
  it('gets a signed checkout session read without an idempotency key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'agentic_session_1',
          status: 'ready_for_payment',
        }),
        { status: 200 }
      )
    );

    const result = await getAgenticCheckoutSession(
      { session_id: 'agentic_session_1' },
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        now: () => new Date('2026-05-21T12:00:00.000Z'),
        requestIdFactory: () => 'request-1',
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      endpoint:
        'https://ogabassey.com/api/agentic/checkout_sessions/agentic_session_1',
      ok: true,
      requestId: 'request-1',
      status: 200,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://ogabassey.com/api/agentic/checkout_sessions/agentic_session_1'
    );
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({
      'api-version': AGENTIC_CHECKOUT_API_VERSION,
      authorization: 'Bearer agentic-api-key',
      'request-id': 'request-1',
      timestamp: '2026-05-21T12:00:00.000Z',
      'user-agent': AGENTIC_CHECKOUT_USER_AGENT,
    });
    const headers = init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBeUndefined();
    expect(headers.signature).toBe(
      createHmac('sha256', 'signing-secret')
        .update(
          JSON.stringify({
            api_version: AGENTIC_CHECKOUT_API_VERSION,
            body: '',
            idempotency_key: '',
            method: 'GET',
            pathname: '/api/agentic/checkout_sessions/agentic_session_1',
            request_id: 'request-1',
            timestamp: '2026-05-21T12:00:00.000Z',
          })
        )
        .digest('hex')
    );
  });

  it('fails closed when checkout credentials are not configured', async () => {
    const fetchImpl = vi.fn();

    const result = await getAgenticCheckoutSession(
      { session_id: 'agentic_session_1' },
      {
        apiBaseUrl: 'https://ogabassey.com',
        fetchImpl,
      }
    );

    expect(result).toEqual({
      error: 'Agentic checkout credentials are not configured',
      ok: false,
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails validation when session_id is missing', async () => {
    const fetchImpl = vi.fn();

    const result = await getAgenticCheckoutSession(
      {} as Parameters<typeof getAgenticCheckoutSession>[0],
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(result.error).toContain('session_id');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns signed read route errors without exposing signing material', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
      })
    );

    const result = await getAgenticCheckoutSession(
      { session_id: 'agentic_session_1' },
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        now: () => new Date('2026-05-21T12:00:00.000Z'),
        requestIdFactory: () => 'request-1',
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      endpoint:
        'https://ogabassey.com/api/agentic/checkout_sessions/agentic_session_1',
      error: 'Session not found',
      ok: false,
      requestId: 'request-1',
      status: 404,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://ogabassey.com/api/agentic/checkout_sessions/agentic_session_1'
    );
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({
      'api-version': AGENTIC_CHECKOUT_API_VERSION,
      authorization: 'Bearer agentic-api-key',
      'request-id': 'request-1',
      timestamp: '2026-05-21T12:00:00.000Z',
      'user-agent': AGENTIC_CHECKOUT_USER_AGENT,
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.signature).toBe(
      createHmac('sha256', 'signing-secret')
        .update(
          JSON.stringify({
            api_version: AGENTIC_CHECKOUT_API_VERSION,
            body: '',
            idempotency_key: '',
            method: 'GET',
            pathname: '/api/agentic/checkout_sessions/agentic_session_1',
            request_id: 'request-1',
            timestamp: '2026-05-21T12:00:00.000Z',
          })
        )
        .digest('hex')
    );
    expect(JSON.stringify(result)).not.toContain('signing-secret');
  });
});

describe('updateAgenticCheckoutSession', () => {
  it('posts a signed checkout session update with an idempotency key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'agentic_session_1',
          status: 'ready_for_payment',
        }),
        { status: 200 }
      )
    );

    const result = await updateAgenticCheckoutSession(
      {
        fulfillment_option_id: 'shipping-standard',
        idempotency_key: 'idem-update-1',
        session_id: 'agentic_session_1',
        shipping_address: {
          address: '1 Test Street',
          city: 'Lagos',
          country_code: 'NG',
        },
      },
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        now: () => new Date('2026-05-21T12:00:00.000Z'),
        requestIdFactory: () => 'request-1',
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      endpoint:
        'https://ogabassey.com/api/agentic/checkout_sessions/agentic_session_1',
      idempotencyKey: 'idem-update-1',
      ok: true,
      requestId: 'request-1',
      status: 200,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      fulfillment_option_id: 'shipping-standard',
      shipping_address: {
        address: '1 Test Street',
        city: 'Lagos',
        country_code: 'NG',
      },
    });
    expect(init.headers).toMatchObject({
      'api-version': AGENTIC_CHECKOUT_API_VERSION,
      authorization: 'Bearer agentic-api-key',
      'content-type': 'application/json',
      'request-id': 'request-1',
      timestamp: '2026-05-21T12:00:00.000Z',
      'user-agent': AGENTIC_CHECKOUT_USER_AGENT,
    });
    const headers = init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('idem-update-1');
    expect(headers.signature).toBe(
      createHmac('sha256', 'signing-secret')
        .update(
          JSON.stringify({
            api_version: AGENTIC_CHECKOUT_API_VERSION,
            body: init.body,
            idempotency_key: 'idem-update-1',
            method: 'POST',
            pathname: '/api/agentic/checkout_sessions/agentic_session_1',
            request_id: 'request-1',
            timestamp: '2026-05-21T12:00:00.000Z',
          })
        )
        .digest('hex')
    );
  });

  it('fails validation when no update fields are provided', async () => {
    const fetchImpl = vi.fn();

    const result = await updateAgenticCheckoutSession(
      { session_id: 'agentic_session_1' },
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      error: 'Invalid checkout session update input',
      ok: false,
      status: 400,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when checkout credentials are not configured', async () => {
    const fetchImpl = vi.fn();

    const result = await updateAgenticCheckoutSession(
      {
        fulfillment_option_id: 'shipping-standard',
        session_id: 'agentic_session_1',
      },
      {
        apiBaseUrl: 'https://ogabassey.com',
        fetchImpl,
      }
    );

    expect(result).toEqual({
      error: 'Agentic checkout credentials are not configured',
      ok: false,
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns update route errors with request recovery details', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );

    const result = await updateAgenticCheckoutSession(
      {
        fulfillment_option_id: 'shipping-standard',
        idempotency_key: 'idem-update-1',
        session_id: 'agentic_session_1',
      },
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        now: () => new Date('2026-05-21T12:00:00.000Z'),
        requestIdFactory: () => 'request-1',
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      endpoint:
        'https://ogabassey.com/api/agentic/checkout_sessions/agentic_session_1',
      error: 'Unauthorized',
      idempotencyKey: 'idem-update-1',
      ok: false,
      requestId: 'request-1',
      status: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('signing-secret');
  });
});

describe('cancelAgenticCheckoutSession', () => {
  it('posts a signed checkout session cancel without a request body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'agentic_session_1',
          status: 'canceled',
        }),
        { status: 200 }
      )
    );

    const result = await cancelAgenticCheckoutSession(
      {
        idempotency_key: 'idem-cancel-1',
        session_id: 'agentic_session_1',
      },
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        now: () => new Date('2026-05-21T12:00:00.000Z'),
        requestIdFactory: () => 'request-1',
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      endpoint:
        'https://ogabassey.com/api/agentic/checkout_sessions/agentic_session_1/cancel',
      idempotencyKey: 'idem-cancel-1',
      ok: true,
      requestId: 'request-1',
      status: 200,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({
      'api-version': AGENTIC_CHECKOUT_API_VERSION,
      authorization: 'Bearer agentic-api-key',
      'request-id': 'request-1',
      timestamp: '2026-05-21T12:00:00.000Z',
      'user-agent': AGENTIC_CHECKOUT_USER_AGENT,
    });
    const headers = init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('idem-cancel-1');
    expect(headers.signature).toBe(
      createHmac('sha256', 'signing-secret')
        .update(
          JSON.stringify({
            api_version: AGENTIC_CHECKOUT_API_VERSION,
            body: '',
            idempotency_key: 'idem-cancel-1',
            method: 'POST',
            pathname: '/api/agentic/checkout_sessions/agentic_session_1/cancel',
            request_id: 'request-1',
            timestamp: '2026-05-21T12:00:00.000Z',
          })
        )
        .digest('hex')
    );
  });

  it('fails closed when checkout credentials are not configured', async () => {
    const fetchImpl = vi.fn();

    const result = await cancelAgenticCheckoutSession(
      {
        idempotency_key: 'idem-cancel-1',
        session_id: 'agentic_session_1',
      },
      {
        apiBaseUrl: 'https://ogabassey.com',
        fetchImpl,
      }
    );

    expect(result).toEqual({
      error: 'Agentic checkout credentials are not configured',
      ok: false,
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails validation when session_id is missing', async () => {
    const fetchImpl = vi.fn();

    const result = await cancelAgenticCheckoutSession(
      {
        idempotency_key: 'idem-cancel-1',
      } as Parameters<typeof cancelAgenticCheckoutSession>[0],
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      error: 'Invalid checkout session cancel input',
      ok: false,
      status: 400,
    });
    expect(JSON.stringify(result.details)).toContain('session_id');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses a generic cancel validation message for invalid idempotency keys', async () => {
    const fetchImpl = vi.fn();

    const result = await cancelAgenticCheckoutSession(
      {
        idempotency_key: 'short',
        session_id: 'agentic_session_1',
      },
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      error: 'Invalid checkout session cancel input',
      ok: false,
      status: 400,
    });
    expect(JSON.stringify(result.details)).toContain('idempotency_key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns cancel route errors with request recovery details', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Session cannot be canceled' }), {
        status: 409,
      })
    );

    const result = await cancelAgenticCheckoutSession(
      {
        idempotency_key: 'idem-cancel-1',
        session_id: 'agentic_session_1',
      },
      {
        apiBaseUrl: 'https://ogabassey.com',
        apiKey: 'agentic-api-key',
        fetchImpl,
        now: () => new Date('2026-05-21T12:00:00.000Z'),
        requestIdFactory: () => 'request-1',
        signingKey: 'signing-secret',
      }
    );

    expect(result).toMatchObject({
      endpoint:
        'https://ogabassey.com/api/agentic/checkout_sessions/agentic_session_1/cancel',
      error: 'Session cannot be canceled',
      idempotencyKey: 'idem-cancel-1',
      ok: false,
      requestId: 'request-1',
      status: 409,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('signing-secret');
  });
});

describe('signAgenticRequest', () => {
  it('matches the canonical request signature payload used by the agentic API', () => {
    expect(
      signAgenticRequest({
        apiVersion: AGENTIC_CHECKOUT_API_VERSION,
        body: '{"items":[]}',
        idempotencyKey: 'idem-1',
        method: 'post',
        pathname: '/api/agentic/checkout_sessions',
        requestId: 'request-1',
        signingKey: 'secret',
        timestamp: '2026-05-21T12:00:00.000Z',
      })
    ).toBe(
      createHmac('sha256', 'secret')
        .update(
          JSON.stringify({
            api_version: AGENTIC_CHECKOUT_API_VERSION,
            body: '{"items":[]}',
            idempotency_key: 'idem-1',
            method: 'POST',
            pathname: '/api/agentic/checkout_sessions',
            request_id: 'request-1',
            timestamp: '2026-05-21T12:00:00.000Z',
          })
        )
        .digest('hex')
    );
  });

  it('includes optional agent identity in the canonical signature payload', () => {
    expect(
      signAgenticRequest({
        agentId: AGENTIC_CHECKOUT_AGENT_ID,
        apiVersion: AGENTIC_CHECKOUT_API_VERSION,
        body: '{"items":[]}',
        idempotencyKey: 'idem-1',
        method: 'post',
        pathname: '/api/agentic/checkout_sessions',
        requestId: 'request-1',
        signingKey: 'secret',
        timestamp: '2026-05-21T12:00:00.000Z',
      })
    ).toBe(
      createHmac('sha256', 'secret')
        .update(
          JSON.stringify({
            api_version: AGENTIC_CHECKOUT_API_VERSION,
            body: '{"items":[]}',
            idempotency_key: 'idem-1',
            method: 'POST',
            pathname: '/api/agentic/checkout_sessions',
            request_id: 'request-1',
            timestamp: '2026-05-21T12:00:00.000Z',
            agent_id: AGENTIC_CHECKOUT_AGENT_ID,
          })
        )
        .digest('hex')
    );
  });
});
