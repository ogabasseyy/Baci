import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    `https://example.test/api/payments/oxygen/host-observation?workflowId=${workflow}&commandId=${command}`
  );
describe('Oxygen host observation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OXYGEN_PRODUCTION_HOST_DIAGNOSTIC_ENABLED', 'true');
    vi.stubEnv('OXYGEN_PRODUCTION_HOST_DIAGNOSTIC_USER_ID', 'pilot-user');
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
        operation: 'approve',
        links: { url: 'https://pay.example.test' },
        rejectedLinks: {},
        secret: 'must-not-return',
      },
    ]);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('returns hostnames only for the configured pilot and owned production workflow', async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({ hostnames: ['pay.example.test'] });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.snapshot).toHaveBeenCalledWith(expect.anything(), workflow);
    expect(mocks.evidence).toHaveBeenCalledWith(
      expect.anything(),
      workflow,
      command,
      'key'
    );
  });
  it('denies other users and disabled diagnostics before accessing evidence', async () => {
    mocks.auth.mockResolvedValueOnce({
      user: { id: 'other' },
      supabase: {},
      error: null,
    });
    expect((await GET(request())).status).toBe(404);
    vi.stubEnv('OXYGEN_PRODUCTION_HOST_DIAGNOSTIC_ENABLED', 'false');
    expect((await GET(request())).status).toBe(404);
    expect(mocks.evidence).not.toHaveBeenCalled();
  });
  it('requires an authenticated session and validates identifiers before database reads', async () => {
    mocks.auth.mockResolvedValueOnce({
      error: 'unauthorized',
      user: null,
      supabase: null,
    });
    expect((await GET(request())).status).toBe(401);
    expect(
      (
        await GET(
          new NextRequest(
            'https://example.test/api/payments/oxygen/host-observation?workflowId=bad'
          )
        )
      ).status
    ).toBe(404);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.evidence).not.toHaveBeenCalled();
  });
  it('rejects staging workflows and unavailable rate limiting', async () => {
    mocks.snapshot.mockResolvedValueOnce({ environment: 'staging' });
    expect((await GET(request())).status).toBe(404);
    mocks.limit.mockRejectedValueOnce(new Error('unavailable'));
    expect((await GET(request())).status).toBe(404);
    expect(mocks.evidence).not.toHaveBeenCalled();
  });
  it('returns 429 without reading a workflow when the rate limit denies access', async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false });
    expect((await GET(request())).status).toBe(429);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.evidence).not.toHaveBeenCalled();
  });
  it('fails closed when the workflow is not owned or evidence cannot be read', async () => {
    mocks.snapshot.mockRejectedValueOnce(new Error('not owned'));
    expect((await GET(request())).status).toBe(404);
    expect(mocks.evidence).not.toHaveBeenCalled();
    mocks.evidence.mockRejectedValueOnce(new Error('mismatch'));
    expect((await GET(request())).status).toBe(404);
  });
});
