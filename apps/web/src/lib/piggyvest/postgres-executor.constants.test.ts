import { expect, it } from 'vitest';
import { PIGGYVEST_POSTGRES_EXECUTOR as limits } from './postgres-executor.constants';

it('bounds execution and requires durable commits and restricted sessions', () => {
  expect(limits.connectTimeoutMs).toBeLessThan(limits.deadlineMs);
  expect(limits.queryTimeoutMs).toBeLessThan(limits.deadlineMs);
  expect(limits.startupOptions).toContain('synchronous_commit=on');
  expect(limits.startupOptions).toContain('search_path=pg_catalog');
  for (const field of [
    'rolsuper',
    'rolbypassrls',
    'rolcreaterole',
    'rolcreatedb',
    'rolreplication',
    'pg_auth_members',
    'pg_is_in_recovery',
  ]) {
    expect(limits.verifySession).toContain(field);
  }
});
