import type { EventEmitter } from 'node:events';
import { Client } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import { rejectLocalPostgresPassword } from './local-postgres-password';

afterEach(() => vi.unstubAllEnvs());

it.each([
  'synthetic-ambient-password',
  '',
])('rejects native password challenges without using ambient credentials (%j)', async (ambientPassword) => {
  vi.stubEnv('PGPASSWORD', ambientPassword);
  vi.stubEnv('PGPASSFILE', '/tmp/synthetic-pgpass-must-not-be-read');
  const client = new Client({ password: rejectLocalPostgresPassword });
  expect(Reflect.get(client, 'password')).toBe(rejectLocalPostgresPassword);
  const rejected = Promise.withResolvers<Error>();
  const connection = Reflect.get(client, 'connection') as EventEmitter;
  connection.once('error', rejected.resolve);
  const getPassword = Reflect.get(client, '_getPassword') as (
    callback: () => void
  ) => void;
  const authenticated = vi.fn();
  getPassword.call(client, authenticated);
  await expect(rejected.promise).resolves.toEqual(
    new Error('Local database password authentication is disabled')
  );
  expect(authenticated).not.toHaveBeenCalled();
});
