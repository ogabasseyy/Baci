import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  snapshot: vi.fn(),
  connection: vi.fn(),
  config: vi.fn(),
  evidence: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({
  checkOxygenProviderRateLimit: mocks.limit,
}));
vi.mock('@/lib/payments/oxygen/runtime-service', () => ({
  readOxygenSnapshot: mocks.snapshot,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: mocks.connection,
}));
vi.mock('@/lib/payments/oxygen/runtime-configuration', () => ({
  readOxygenRuntimeConfiguration: mocks.config,
}));
vi.mock('@/lib/payments/oxygen/response-evidence', () => ({
  readOxygenResponseEvidence: mocks.evidence,
}));

import { GET } from './route';

const workflow = 'f1ab0000-0000-4000-8000-000000000011';
const command = 'f1ab0000-0000-4000-8000-000000000012';
const request = () =>
  new NextRequest(
    `https://example.test/api/payments/oxygen/eligibility-evidence?workflowId=${workflow}&commandId=${command}`
  );
const raw =
  '{ "offers": [], "link": "https://example.test/?token=private-fixture" }\n';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OXYGEN_PRODUCTION_ELIGIBILITY_DIAGNOSTIC_ENABLED', 'true');
  vi.stubEnv('OXYGEN_PRODUCTION_ELIGIBILITY_DIAGNOSTIC_USER_ID', 'pilot-user');
  mocks.auth.mockResolvedValue({
    user: { id: 'pilot-user' },
    supabase: {},
    error: null,
  });
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.snapshot.mockResolvedValue({ environment: 'production' });
  mocks.connection.mockReturnValue({
    environment: 'production',
    worker: async () => ({}),
  });
  mocks.config.mockReturnValue({
    environment: 'production',
    evidenceKey: 'key',
  });
  mocks.evidence.mockResolvedValue([
    {
      operation: 'eligibility',
      httpStatus: 200,
      eligibilityRaw: {
        capture: 'complete',
        bodyBase64: Buffer.from(raw).toString('base64'),
      },
    },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

it('returns the exact eligibility response only for the configured owner', async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    responses: [{ httpStatus: 200, capture: 'complete', body: raw }],
  });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(mocks.snapshot).toHaveBeenCalledWith(expect.anything(), workflow);
  expect(mocks.evidence).toHaveBeenCalledWith(
    expect.anything(),
    workflow,
    command,
    'key'
  );
});

it('denies other users or disabled diagnostics without reading the workflow', async () => {
  mocks.auth.mockResolvedValueOnce({
    user: { id: 'other' },
    supabase: {},
    error: null,
  });
  expect((await GET(request())).status).toBe(404);
  vi.stubEnv('OXYGEN_PRODUCTION_ELIGIBILITY_DIAGNOSTIC_ENABLED', 'false');
  expect((await GET(request())).status).toBe(404);
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.evidence).not.toHaveBeenCalled();
});

it('rejects unowned workflows, non-eligibility records and malformed captures', async () => {
  mocks.snapshot.mockRejectedValueOnce(new Error('not owned'));
  expect((await GET(request())).status).toBe(404);
  expect(mocks.evidence).not.toHaveBeenCalled();
  mocks.evidence.mockResolvedValueOnce([
    {
      operation: 'approve',
      httpStatus: 200,
      eligibilityRaw: {
        capture: 'complete',
        bodyBase64: Buffer.from(raw).toString('base64'),
      },
    },
  ]);
  expect((await GET(request())).status).toBe(404);
  mocks.evidence.mockResolvedValueOnce([
    {
      operation: 'eligibility',
      httpStatus: 200,
      eligibilityRaw: { capture: 'complete', bodyBase64: 'not base64' },
    },
  ]);
  expect((await GET(request())).status).toBe(404);
});

it('denies unauthenticated requests, staging workflows and rate-limited reads', async () => {
  mocks.auth.mockResolvedValueOnce({
    user: null,
    supabase: null,
    error: 'unauthorized',
  });
  expect((await GET(request())).status).toBe(401);
  mocks.snapshot.mockResolvedValueOnce({ environment: 'staging' });
  expect((await GET(request())).status).toBe(404);
  mocks.limit.mockResolvedValueOnce({ allowed: false });
  expect((await GET(request())).status).toBe(429);
  expect(mocks.evidence).not.toHaveBeenCalled();
});

it('rate limits the operator without checking whether the requested workflow exists', async () => {
  mocks.limit.mockResolvedValueOnce({ allowed: false });
  expect((await GET(request())).status).toBe(429);
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.evidence).not.toHaveBeenCalled();
});

it('does not disclose evidence when command binding or decryption fails', async () => {
  mocks.evidence.mockRejectedValueOnce(new Error('mismatched command'));
  expect((await GET(request())).status).toBe(404);
});

it('returns unavailable when the evidence RPC has expired the record', async () => {
  mocks.evidence.mockResolvedValueOnce([]);
  const response = await GET(request());
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Unavailable' });
});
