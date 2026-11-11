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
  canonicalTemplate: 'https://{slug}.merchant.test/',
};
it('parses explicit isolated origins and a fixed merchant template', () => {
  const parsed = parseVerifierProductionConfig(valid);
  expect(parsed.canonicalBase('synthetic')).toBe(
    'https://synthetic.merchant.test/'
  );
  expect(parsed.key).toHaveLength(32);
});
it.each([
  { databaseUrl: 'postgresql://postgres:password@db.test:5432/postgres' },
  {
    databaseUrl:
      'postgresql://baci_experience_verifier_login:password@db.test:6543/postgres',
  },
  { key: valid.runner.key },
  { canonicalTemplate: 'http://{slug}.merchant.test/' },
  { canonicalTemplate: 'https://evil.test/?slug={slug}' },
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
