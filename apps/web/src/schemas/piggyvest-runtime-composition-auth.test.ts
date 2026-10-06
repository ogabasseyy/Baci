import { expect, it } from 'vitest';
import { runtimeCompositionAuthSchema as schema } from './piggyvest-runtime-composition-auth';

it('accepts only explicit public key origins and rejects credential or private options', () => {
  const configuration = {
    url: 'http://127.0.0.1:55555',
    publicKey: `sb_publishable_${'a'.repeat(20)}`,
    syntheticLoopback: true,
  };
  expect(schema.parse(configuration)).toEqual(configuration);
  for (const value of [
    null,
    { ...configuration, secret: 'private' },
    { ...configuration, publicKey: 'sb_secret_private' },
    { ...configuration, url: 'http://evil.invalid' },
    {
      ...configuration,
      url: 'https://user:password@abcdefghijklmnopqrst.supabase.co',
    },
  ])
    expect(schema.safeParse(value).success).toBe(false);
});
