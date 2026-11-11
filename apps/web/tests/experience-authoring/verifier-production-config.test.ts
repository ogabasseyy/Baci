import { expect, it } from 'vitest';
import { parseVerifierProductionConfig } from '../../tools/experience-verifier/production-config';

const key = (n: number) => Buffer.alloc(32, n).toString('base64url');
const valid = {
  databaseUrl:
    'postgresql://baci_experience_verifier_login.project:synthetic@pooler.example.test:5432/postgres',
  port: 8891,
  key: key(1),
  runner: {
    endpoint: 'https://runner.runtime.test/v1/execute',
    key: key(2),
    toolchainDigest: 'a'.repeat(64),
  },
  previewOrigin: 'https://builder.baci.test',
  executionOrigin: 'https://output.runtime.test',
  supabase: {
    url: 'https://project.supabase.co',
    anonKey: 'sb_publishable_synthetic',
  },
  rootDomain: 'merchant.test',
};
it('parses explicit isolated origins and resolves the merchant domain', async () => {
  const parsed = parseVerifierProductionConfig(valid);
  await expect(
    parsed.canonicalBase('synthetic', {
      rpc: async () => ({ data: null, error: null }),
    } as never)
  ).resolves.toBe('https://synthetic.merchant.test');
  expect(parsed.key).toHaveLength(32);
});
it.each([
  { databaseUrl: 'postgresql://postgres:password@db.test:5432/postgres' },
  {
    databaseUrl:
      'postgresql://baci_experience_verifier_login:password@db.test:6543/postgres',
  },
  { key: valid.runner.key },
  { rootDomain: 'http://merchant.test' },
  { rootDomain: 'merchant.test/path' },
  { executionOrigin: 'https://output.merchant.test' },
  {
    supabase: {
      url: 'https://project.supabase.co',
      anonKey: 'service_role_secret',
    },
  },
])('fails closed for unsafe configuration: %j', (invalid) => {
  expect(() => parseVerifierProductionConfig({ ...valid, ...invalid })).toThrow(
    'INVALID_VERIFIER_CONFIG'
  );
});
