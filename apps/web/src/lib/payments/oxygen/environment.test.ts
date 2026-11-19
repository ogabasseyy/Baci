import { afterEach, expect, it, vi } from 'vitest';
import { resolveOxygenEnvironment } from './environment';

afterEach(() => vi.unstubAllEnvs());
it.each([
  ['production', 'production', '', 'production'],
  ['production', 'production', 'production', 'production'],
  ['production', 'production', 'staging', null],
  ['preview', 'production', '', 'staging'],
  ['preview', 'production', 'staging', 'staging'],
  ['preview', 'production', 'production', null],
  ['', 'production', '', null],
  ['', 'production', 'staging', null],
  ['', '', 'staging', null],
  ['', 'test', 'staging', 'staging'],
  ['', 'test', 'production', null],
  ['development', 'production', 'staging', 'staging'],
  ['', 'production', 'production', 'production'],
  ['', 'development', '', 'staging'],
  ['', 'development', 'staging', 'staging'],
  ['unexpected', 'production', '', null],
  ['preview', 'production', 'unexpected', null],
] as const)('resolves Vercel=%s Node=%s explicit=%s as %s', (vercel, node, explicit, expected) => {
  vi.stubEnv('VERCEL_ENV', vercel);
  vi.stubEnv('NODE_ENV', node);
  vi.stubEnv('OXYGEN_ENVIRONMENT', explicit);
  expect(resolveOxygenEnvironment()).toBe(expected);
});
