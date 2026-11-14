import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPiggyvestIntakeClient } from './server-intake-client';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ createServiceClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('pg', () => ({
  Client: class {
    connect = vi.fn();
    query = vi.fn();
    end = vi.fn();
  },
}));

const settings = {
  PIGGYVEST_PRIMARY_DB_HOST: 'db.example.com',
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
  PIGGYVEST_PRIMARY_DB_CA: 'test-ca',
  PIGGYVEST_WEBHOOK_INTAKE_DB_PASSWORD: 'test-only',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('createPiggyvestIntakeClient', () => {
  it('builds a restricted-login client without constructing a service-role client', () => {
    for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value);
    const client = createPiggyvestIntakeClient();
    expect(typeof client.from).toBe('function');
    expect(typeof client.rpc).toBe('function');
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it.each(
    Object.keys(settings)
  )('throws (no service-role fallback) when %s is unset', (missing) => {
    for (const [key, value] of Object.entries(settings))
      vi.stubEnv(key, key === missing ? '' : value);
    expect(() => createPiggyvestIntakeClient()).toThrow();
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });
});
