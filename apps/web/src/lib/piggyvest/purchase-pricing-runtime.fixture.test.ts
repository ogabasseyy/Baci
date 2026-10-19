import type { EventEmitter } from 'node:events';
import { Client } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import {
  authenticatedReader,
  configuration,
  database,
  goal,
  query,
} from './purchase-pricing-runtime.fixture';

type PgModule = typeof import('pg');

vi.mock('pg', () => ({ Client: vi.fn() }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it.each([
  'synthetic-ambient-password',
  '',
])('keeps direct local queries independent of environment/password-file fallback (%j)', async (ambientPassword) => {
  vi.stubEnv(
    'PIGGYVEST_LOCAL_TEST_SOCKET',
    '/private/tmp/baci-piggyvest-runtime.synthetic/socket'
  );
  vi.stubEnv('PGPASSWORD', ambientPassword);
  vi.stubEnv('PGPASSFILE', '/tmp/synthetic-pgpass-must-not-be-read');
  const actualPg = await vi.importActual<PgModule>('pg');
  let nativeClient: Client | undefined;
  vi.mocked(Client).mockImplementation(function captureOptions(configuration) {
    nativeClient = new actualPg.Client(configuration);
    return {
      connect: async () => undefined,
      query: async () => ({ rows: [{ result: 'synthetic' }] }),
      end: async () => undefined,
    } as unknown as Client;
  });
  await expect(query('purchase_pricing_customer', 'SELECT 1')).resolves.toEqual(
    { rows: [{ result: 'synthetic' }] }
  );
  expect(nativeClient).toBeDefined();
  if (!nativeClient) throw new Error('Expected native fixture client');
  const password: unknown = Reflect.get(nativeClient, 'password');
  expect(password).toBeTypeOf('function');
  expect(password).not.toBe('synthetic-ambient-password');
  const rejected = Promise.withResolvers<Error>();
  const connection = Reflect.get(nativeClient, 'connection') as EventEmitter;
  connection.once('error', rejected.resolve);
  const getPassword = Reflect.get(nativeClient, '_getPassword') as (
    callback: () => void
  ) => void;
  const authenticated = vi.fn();
  getPassword.call(nativeClient, authenticated);
  await expect(rejected.promise).resolves.toEqual(
    new Error('Local database password authentication is disabled')
  );
  expect(authenticated).not.toHaveBeenCalled();
});

it('rejects remote and missing database transport before connecting', () => {
  vi.stubEnv('PIGGYVEST_LOCAL_TEST_SOCKET', 'remote.example');
  expect(() => database()).toThrow();
  vi.stubEnv('PIGGYVEST_LOCAL_TEST_SOCKET', '');
  expect(() => database()).toThrow();
});
it('keeps fixture scope explicit and rejects unsupported RLS projections', () => {
  expect(configuration()).toMatchObject({
    transport: 'local_test',
    expectedProjectId: 'synthetic',
    actualProjectId: 'synthetic',
  });
  expect(goal(243)).toBe('30000000-0000-4000-8000-000000000243');
  expect(() => authenticatedReader().from('secrets')).toThrow(
    'Unexpected table'
  );
  expect(() =>
    authenticatedReader().from('products').select('id').eq('secret', 'value')
  ).toThrow('Unexpected filter');
});
