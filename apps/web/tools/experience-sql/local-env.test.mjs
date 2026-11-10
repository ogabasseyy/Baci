import assert from 'node:assert/strict';
import test from 'node:test';
import { localExperienceSqlEnv } from './local-env.mjs';

test('qualification fixes the disposable local database major rather than accepting a hosted target', () => {
  const env = localExperienceSqlEnv();
  assert.equal(env.BACI_BUILDER_LOCAL_PG, '1');
  assert.equal(env.BACI_BUILDER_LOCAL_PG_MAJOR, '17');
});

test('child qualification excludes hosted and provider credentials but keeps local tools', () => {
  const keys = [
    'DATABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
  ];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = 'forbidden-local-test';
    const env = localExperienceSqlEnv();
    for (const key of keys) assert.equal(env[key], undefined);
    assert.equal(env.PATH, process.env.PATH);
  } finally {
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
});
