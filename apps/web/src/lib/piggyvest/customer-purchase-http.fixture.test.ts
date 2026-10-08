import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { server, termsDocument } from './customer-purchase-http.fixture';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllEnvs());
it('hashes the exact synthetic UTF8 consent text', () => {
  expect(termsDocument.hash).toBe(
    createHash('sha256').update(termsDocument.text, 'utf8').digest('hex')
  );
  expect(termsDocument.version).toBe('synthetic-http');
});
it('cannot start the HTTP fixture without validated local database configuration', () => {
  vi.stubEnv('PIGGYVEST_LOCAL_TEST_SOCKET', 'https://remote.example');
  expect(() => server(243)).toThrow();
});
