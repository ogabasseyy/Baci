import { afterEach, expect, it, vi } from 'vitest';
import {
  authenticatedReader,
  configuration,
  database,
  goal,
} from './purchase-pricing-runtime.fixture';

afterEach(() => vi.unstubAllEnvs());
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
