import './test-env.test-setup.mjs';
import { describe, expect, it, vi } from 'vitest';

const mockRunTenantA = vi.fn(async () => ({ tenantAClaims: { inbox_id: 1 } }));
const mockRunTenantB = vi.fn().mockResolvedValue(undefined);
const mockTeardown = vi.fn().mockResolvedValue(undefined);

vi.mock('./browser-session.mjs', () => ({
  launchIsolatedBrowser: vi.fn(async () => ({})),
}));
vi.mock('./fixture-server.mjs', () => ({
  buildFixture: vi.fn(async () => '/tmp/site'),
  startFixtureServer: vi.fn(async () => ({ close: vi.fn() })),
}));
vi.mock('./tls.mjs', () => ({
  assertPortAvailable: vi.fn().mockResolvedValue(undefined),
  createTlsCertificate: vi.fn().mockResolvedValue(undefined),
  writeCaddyfile: vi.fn().mockResolvedValue(undefined),
  startTlsProxy: vi.fn(() => ({ kill: vi.fn() })),
  waitForHttps: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./scenario-tenant-a.mjs', () => ({
  runTenantA: (...args) => mockRunTenantA(...args),
}));
vi.mock('./scenario-tenant-b.mjs', () => ({
  runTenantB: (...args) => mockRunTenantB(...args),
}));
vi.mock('./failure-diagnostics.mjs', () => ({
  reportFailure: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./teardown.mjs', () => ({
  teardown: (...args) => mockTeardown(...args),
}));

describe('chatwoot-widget-browser run entrypoint', () => {
  it('runs tenant A and tenant B scenarios and always executes teardown', async () => {
    await import('./run.mjs');

    expect(mockRunTenantA).toHaveBeenCalledTimes(1);
    expect(mockRunTenantB).toHaveBeenCalledTimes(1);
    expect(mockTeardown).toHaveBeenCalledTimes(1);
  });
});
