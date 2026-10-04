import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
}));

import { DELETE, GET, POST } from './route';

const MERCHANT_ID = '123e4567-e89b-42d3-a456-426614174001';
const OTHER_MERCHANT_ID = '123e4567-e89b-42d3-a456-426614174009';
const USER_ID = '123e4567-e89b-42d3-a456-426614174002';
const BRANCH_ID = '123e4567-e89b-42d3-a456-426614174003';
const GRANT_ID = '123e4567-e89b-42d3-a456-426614174004';
const GRANT_ID_2 = '123e4567-e89b-42d3-a456-426614174005';

const grantRow = {
  id: GRANT_ID,
  connection_id: `muse_${MERCHANT_ID}_abc123`,
  user_id: USER_ID,
  merchant_id: MERCHANT_ID,
  branch_ids: [BRANCH_ID],
  merchant_wide: false,
  scopes: ['orders:read'],
  status: 'active',
  version: 1,
  expires_at: null,
  revoked_at: null,
  revoke_reason: null,
  created_at: '2026-10-01T11:00:00.000Z',
  updated_at: '2026-10-01T11:00:00.000Z',
  request_fingerprint: createHash('sha256')
    .update(
      JSON.stringify({
        merchantId: MERCHANT_ID,
        branchIds: [BRANCH_ID],
        scopes: ['orders:read'],
        merchantWide: false,
        expiresInSeconds: null,
        expiresAt: null,
      })
    )
    .digest('hex'),
};

type QueryResult = { data: unknown; error: { message: string } | null };

let queryResults: QueryResult[];
let selectColumns: string[];
let rpcCalls: Array<{ name: string; args: unknown }>;
let rpcImpl: (name: string, args: unknown) => Promise<QueryResult>;

type ChainQuery = {
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (
    resolve: (value: QueryResult) => void,
    reject: (reason?: unknown) => void
  ) => void;
};

function createChain(): ChainQuery {
  const next = (): QueryResult =>
    queryResults.shift() ?? { data: null, error: null };
  const chain: ChainQuery = {
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(next())),
    // Supabase builders are thenable: list reads await the chain directly.
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock.
    then: (resolve) => {
      resolve(next());
    },
  };
  return chain;
}

const mockFrom = vi.fn((_table: string) => ({
  select: vi.fn((columns: string) => {
    selectColumns.push(columns);
    return createChain();
  }),
}));

const mockRpc = vi.fn((name: string, args: unknown) => rpcImpl(name, args));

const OWNER_ACCESS = {
  isStaff: false,
  isOwner: true,
  role: null,
  permissions: {},
};

const STAFF_ACCESS = {
  isStaff: true,
  isOwner: false,
  role: 'manager',
  permissions: {},
};

function createRequest(
  method: string,
  body?: unknown,
  search = ''
): NextRequest {
  return new NextRequest(`https://usebaci.com/api/integrations/muse${search}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('/api/integrations/muse', () => {
  beforeEach(() => {
    mockAuthenticateApiRequest.mockReset();
    mockCheckCsrfProtection.mockReset();
    mockGetMerchantForApiRequest.mockReset();
    mockFrom.mockClear();
    mockRpc.mockClear();
    queryResults = [];
    selectColumns = [];
    rpcCalls = [];
    rpcImpl = async () => ({ data: null, error: null });

    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      user: { id: USER_ID },
      supabase: { from: mockFrom, rpc: mockRpc },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: MERCHANT_ID,
      staffAccess: OWNER_ACCESS,
    });
    const baseRpcImpl = rpcImpl;
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return baseRpcImpl(name, args);
    };
  });

  it('GET requires authentication', async () => {
    mockAuthenticateApiRequest.mockResolvedValueOnce({
      error: 'Not authenticated',
      user: null,
      supabase: null,
    });

    const response = await GET(createRequest('GET'));
    expect(response.status).toBe(401);
  });

  it('GET is owners-only server-side', async () => {
    mockGetMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: MERCHANT_ID,
      staffAccess: STAFF_ACCESS,
    });

    const response = await GET(createRequest('GET'));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('FORBIDDEN_SCOPE');
  });

  it('GET lists every active connection without selecting token hashes', async () => {
    const secondRow = {
      ...grantRow,
      id: GRANT_ID_2,
      connection_id: `muse_${MERCHANT_ID}_def456`,
      scopes: ['analytics:read'],
    };
    queryResults = [{ data: [grantRow, secondRow], error: null }];

    const response = await GET(
      createRequest('GET', undefined, `?merchantId=${MERCHANT_ID}`)
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connections).toHaveLength(2);
    expect(body.connections[0]).toMatchObject({
      grantId: GRANT_ID,
      merchantId: MERCHANT_ID,
      branchIds: [BRANCH_ID],
      scopes: ['orders:read'],
      status: 'active',
      usable: true,
    });
    expect(body.connections[1].grantId).toBe(GRANT_ID_2);
    expect(JSON.stringify(body)).not.toMatch(/token_hash/i);
    expect(selectColumns.length).toBeGreaterThan(0);
    for (const columns of selectColumns) {
      expect(columns).not.toMatch(/token_hash/);
    }
  });

  it('GET returns an empty list when no active grant exists', async () => {
    queryResults = [{ data: [], error: null }];

    const response = await GET(createRequest('GET'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connections: [] });
  });

  it('GET fails closed when the grant read fails', async () => {
    queryResults = [{ data: null, error: { message: 'connection reset' } }];

    const response = await GET(createRequest('GET'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('UNKNOWN_OUTCOME');
    expect(JSON.stringify(body)).not.toContain('connection reset');
  });

  it('GET fails closed on an unparseable grant row', async () => {
    queryResults = [{ data: [{ unexpected: true }], error: null }];

    const response = await GET(createRequest('GET'));
    expect(response.status).toBe(500);
  });

  it('POST is owners-only server-side', async () => {
    mockGetMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: MERCHANT_ID,
      staffAccess: STAFF_ACCESS,
    });

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        scopes: ['orders:read'],
        merchantWide: true,
      })
    );
    expect(response.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('POST refuses an empty-scope grant and enforces merchant scope', async () => {
    const empty = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        branchIds: [],
        merchantWide: false,
        scopes: ['orders:read'],
      })
    );
    expect(empty.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();

    const mismatch = await POST(
      createRequest('POST', {
        merchantId: OTHER_MERCHANT_ID,
        merchantWide: true,
        scopes: ['orders:read'],
      })
    );
    expect(mismatch.status).toBe(403);
  });

  it('POST creates a second grant while another stays active', async () => {
    queryResults = [{ data: grantRow, error: null }];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: GRANT_ID_2, error: null };
    };

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        branchIds: [BRANCH_ID],
        scopes: ['orders:read'],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.alreadyConnected).toBe(false);
    expect(body).toHaveProperty('token');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('POST reissues credentials for a stable connection id retry', async () => {
    queryResults = [{ data: grantRow, error: null }];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: true, error: null };
    };

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        branchIds: [BRANCH_ID],
        scopes: ['orders:read'],
        connectionId: grantRow.connection_id,
        expiresInSeconds: null,
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.alreadyConnected).toBe(true);
    expect(body.reissued).toBe(true);
    expect(body.grant.grantId).toBe(GRANT_ID);
    // Lost first response recovers with a fresh pair, not metadata alone.
    expect(typeof body.token).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      name: 'reissue_connector_grant_tokens',
      args: { p_grant_id: GRANT_ID },
    });
    const args = rpcCalls[0].args as Record<string, unknown>;
    expect(args.p_new_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_new_refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['scopes', { scopes: ['inventory:read'] }, {}],
    ['branches', { branchIds: [OTHER_MERCHANT_ID] }, {}],
    ['merchant-wide access', { merchantWide: true }, {}],
    ['requested lifetime', { expiresInSeconds: 3600 }, {}],
    ['stored expiry drift', {}, { expires_at: '2099-01-01T00:00:00.000Z' }],
    ['legacy grant without request proof', {}, { request_fingerprint: null }],
  ])('POST rejects a reused id with different %s in both retry paths', async (_name, changedRequest, changedRow) => {
    for (const race of [false, true]) {
      mockRpc.mockClear();
      rpcCalls = [];
      queryResults = [
        ...(race ? [{ data: null, error: null }] : []),
        { data: { ...grantRow, ...changedRow }, error: null },
      ];
      rpcImpl = async (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        if (name.startsWith('create_connector_grant_for_request')) {
          return {
            data: null,
            error: {
              message:
                'duplicate key value violates unique constraint "connector_grants_connection_id_key"',
            },
          };
        }
        return { data: true, error: null };
      };
      const response = await POST(
        createRequest('POST', {
          merchantId: MERCHANT_ID,
          branchIds: [BRANCH_ID],
          scopes: ['orders:read'],
          merchantWide: false,
          connectionId: grantRow.connection_id,
          expiresInSeconds: null,
          ...changedRequest,
        })
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
      expect(
        rpcCalls.some((call) => call.name === 'reissue_connector_grant_tokens')
      ).toBe(false);
    }
  });

  it('POST reports a conflict when the retry match changed', async () => {
    queryResults = [{ data: grantRow, error: null }];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: false, error: null };
    };

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        branchIds: [BRANCH_ID],
        scopes: ['orders:read'],
        connectionId: grantRow.connection_id,
        expiresInSeconds: null,
      })
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body).not.toHaveProperty('token');
  });

  it('POST rejects an inactive stable connection id without trying to create', async () => {
    queryResults = [
      {
        data: {
          ...grantRow,
          status: 'revoked',
          revoked_at: '2026-10-02T00:00:00.000Z',
        },
        error: null,
      },
    ];

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        branchIds: [BRANCH_ID],
        scopes: ['orders:read'],
        connectionId: grantRow.connection_id,
        expiresInSeconds: null,
      })
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.error).toContain('disconnected');
    expect(body.error).toContain('new connectionId');
    expect(rpcCalls).toHaveLength(0);
  });

  it('POST maps reissue denials without leaking internals', async () => {
    queryResults = [{ data: grantRow, error: null }];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: null, error: { message: 'connector_grant_forbidden' } };
    };

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        branchIds: [BRANCH_ID],
        scopes: ['orders:read'],
        connectionId: grantRow.connection_id,
        expiresInSeconds: null,
      })
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('FORBIDDEN_SCOPE');
    expect(body).not.toHaveProperty('token');
  });

  it('POST rejects an invalid connection id', async () => {
    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        scopes: ['orders:read'],
        merchantWide: true,
        connectionId: 'has spaces!',
      })
    );
    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('POST reports database failure during duplicate-key recovery', async () => {
    queryResults = [
      { data: null, error: null },
      { data: null, error: { message: 'database unavailable' } },
    ];
    rpcImpl = async () => ({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "connector_grants_connection_id_key"',
      },
    });
    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        scopes: ['orders:read'],
        merchantWide: true,
        connectionId: grantRow.connection_id,
        expiresInSeconds: null,
      })
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('POST does not recover unrelated unique constraints by rotating a grant', async () => {
    queryResults = [
      { data: null, error: null },
      { data: grantRow, error: null },
    ];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return {
        data: null,
        error: {
          message:
            'duplicate key value violates unique constraint "connector_grants_token_hash_key"',
        },
      };
    };
    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        scopes: ['orders:read'],
        merchantWide: true,
        connectionId: grantRow.connection_id,
        expiresInSeconds: null,
      })
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    expect(rpcCalls.map((call) => call.name)).toEqual([
      'create_connector_grant_for_request',
    ]);
  });

  it('POST reissues the winning grant after a lost connection-id race', async () => {
    queryResults = [
      { data: null, error: null },
      { data: grantRow, error: null },
    ];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === 'create_connector_grant_for_request') {
        return {
          data: null,
          error: {
            message:
              'duplicate key value violates unique constraint "connector_grants_connection_id_key"',
          },
        };
      }
      return { data: true, error: null };
    };

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        scopes: ['orders:read'],
        merchantWide: false,
        branchIds: [BRANCH_ID],
        connectionId: grantRow.connection_id,
        expiresInSeconds: null,
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.alreadyConnected).toBe(true);
    expect(body.reissued).toBe(true);
    expect(body.grant.grantId).toBe(GRANT_ID);
    expect(typeof body.token).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(rpcCalls.map((call) => call.name)).toEqual([
      'create_connector_grant_for_request',
      'reissue_connector_grant_tokens',
    ]);
  });

  it('POST refuses to issue credentials when the grant read fails', async () => {
    queryResults = [{ data: null, error: { message: 'connection reset' } }];

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        merchantWide: true,
        scopes: ['orders:read'],
        connectionId: 'retry-stable-id',
      })
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('UNKNOWN_OUTCOME');
    expect(body).not.toHaveProperty('token');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('POST fails closed on an unparseable retry lookup row', async () => {
    queryResults = [{ data: { unexpected: 'shape' }, error: null }];

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        merchantWide: true,
        scopes: ['orders:read'],
        connectionId: 'retry-stable-id',
      })
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('UNKNOWN_OUTCOME');
    expect(body).not.toHaveProperty('token');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('POST creates a scoped grant and returns the token pair once', async () => {
    queryResults = [{ data: grantRow, error: null }];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: GRANT_ID, error: null };
    };

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        branchIds: [BRANCH_ID],
        expiresInSeconds: 3600,
        merchantWide: false,
        scopes: ['orders:read', 'inventory:read'],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.token).toMatch(/^mcn_[0-9a-f]{64}$/);
    expect(body.refreshToken).toMatch(/^mcn_refresh_[0-9a-f]{64}$/);
    expect(body.grant.scopes).toEqual(['orders:read']);
    expect(JSON.stringify(body.grant)).not.toMatch(/token_hash/i);

    expect(rpcCalls).toHaveLength(1);
    const call = rpcCalls[0] as {
      name: string;
      args: Record<string, unknown>;
    };
    expect(call.name).toBe('create_connector_grant_for_request');
    expect(call.args.p_merchant_id).toBe(MERCHANT_ID);
    expect(call.args.p_scopes).toEqual(['orders:read', 'inventory:read']);
    expect(call.args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.args.p_refresh_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.args.p_token_hash).not.toContain(body.token);
  });

  it.each([
    null,
    { message: 'database unavailable' },
  ])('POST returns the token pair when the create reread fails (%j)', async (error) => {
    queryResults = [{ data: { unexpected: 'shape' }, error }];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: GRANT_ID, error: null };
    };

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        branchIds: [BRANCH_ID],
        expiresInSeconds: 3600,
        merchantWide: false,
        scopes: ['orders:read', 'inventory:read'],
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.token).toMatch(/^mcn_[0-9a-f]{64}$/);
    expect(body.refreshToken).toMatch(/^mcn_refresh_[0-9a-f]{64}$/);
    // Fallback view built from the request, not guessed.
    expect(body.grant).toMatchObject({
      grantId: GRANT_ID,
      merchantId: MERCHANT_ID,
      branchIds: [BRANCH_ID],
      merchantWide: false,
      scopes: ['orders:read', 'inventory:read'],
      status: 'active',
      version: 1,
      usable: true,
    });
    expect(body.grant.expiresAt).toEqual(expect.any(String));
  });

  it('POST returns 409 when the connection id belongs elsewhere', async () => {
    queryResults = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return {
        data: null,
        error: {
          message:
            'duplicate key value violates unique constraint "connector_grants_connection_id_key"',
        },
      };
    };

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        scopes: ['orders:read'],
        merchantWide: true,
        connectionId: 'mcn_someone_elses_id',
      })
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body).not.toHaveProperty('token');
  });

  it('POST maps RPC denials without leaking internals', async () => {
    queryResults = [];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return {
        data: null,
        error: { message: 'invalid_connector_grant_branch' },
      };
    };

    const response = await POST(
      createRequest('POST', {
        merchantId: MERCHANT_ID,
        branchIds: [BRANCH_ID],
        scopes: ['orders:read'],
      })
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('FORBIDDEN_SCOPE');
    expect(JSON.stringify(body)).not.toContain('invalid_connector_grant');
  });

  it('DELETE is owners-only and revokes the merchant grant', async () => {
    mockGetMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: MERCHANT_ID,
      staffAccess: STAFF_ACCESS,
    });
    const denied = await DELETE(
      createRequest('DELETE', { merchantId: MERCHANT_ID, grantId: GRANT_ID })
    );
    expect(denied.status).toBe(403);

    queryResults = [{ data: grantRow, error: null }];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: true, error: null };
    };
    const response = await DELETE(
      createRequest('DELETE', { merchantId: MERCHANT_ID, grantId: GRANT_ID })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.revoked).toBe(true);
    expect(body.grant.status).toBe('revoked');
    expect(rpcCalls[0]).toMatchObject({
      name: 'revoke_connector_grant',
      args: { p_grant_id: GRANT_ID, p_reason: 'merchant disconnect' },
    });
  });

  it('DELETE revokes an expired-but-active grant', async () => {
    queryResults = [
      {
        data: { ...grantRow, expires_at: '2020-01-01T00:00:00.000Z' },
        error: null,
      },
    ];
    rpcImpl = async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: true, error: null };
    };
    const response = await DELETE(
      createRequest('DELETE', { merchantId: MERCHANT_ID, grantId: GRANT_ID })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.revoked).toBe(true);
    expect(body.grant.status).toBe('revoked');
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ name: 'revoke_connector_grant' });
  });

  it('DELETE reports a database read failure instead of a missing grant', async () => {
    queryResults = [{ data: null, error: { message: 'database unavailable' } }];
    const response = await DELETE(
      createRequest('DELETE', { merchantId: MERCHANT_ID, grantId: GRANT_ID })
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('DELETE hides cross-merchant and unknown grants', async () => {
    queryResults = [
      { data: { ...grantRow, merchant_id: OTHER_MERCHANT_ID }, error: null },
    ];
    const cross = await DELETE(
      createRequest('DELETE', { merchantId: MERCHANT_ID, grantId: GRANT_ID })
    );
    expect(cross.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();

    queryResults = [{ data: null, error: null }];
    const unknown = await DELETE(
      createRequest('DELETE', { merchantId: MERCHANT_ID, grantId: GRANT_ID })
    );
    expect(unknown.status).toBe(404);
  });
});
