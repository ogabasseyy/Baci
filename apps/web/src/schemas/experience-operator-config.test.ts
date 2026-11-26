import { expect, it } from 'vitest';
import {
  runnerPreflightReceipt,
  runnerProductionConfig,
  verifierProductionConfig,
} from './experience-operator-config';

const key = Buffer.alloc(32, 3).toString('base64url');
const toolchainDigest = 'a'.repeat(64);

it('validates runner launch input and the helper receipt', () => {
  const runner = { key, toolchainDigest, loopbackPort: 1234 };
  expect(runnerProductionConfig.parse(runner)).toEqual(runner);
  expect(
    runnerProductionConfig.safeParse({ ...runner, key: key.slice(1) }).success
  ).toBe(false);
  expect(runnerPreflightReceipt.parse({ toolchainDigest })).toEqual({
    toolchainDigest,
  });
  expect(
    runnerPreflightReceipt.safeParse({ toolchainDigest, extra: 1 }).success
  ).toBe(false);
});

it('requires complete verifier routing configuration', () => {
  const config = {
    databaseUrl: 'postgresql://synthetic@db.example.com/postgres',
    port: 1234,
    key,
    runner: { endpoint: 'http://127.0.0.1:5678', key, toolchainDigest },
    previewOrigin: 'https://preview.example.com',
    executionOrigin: 'https://output.example.net',
    supabase: { url: 'https://project.example.com', anonKey: 'synthetic' },
    rootDomain: 'example.com',
    publicObserver: 'co-located',
  };
  expect(verifierProductionConfig.parse(config)).toEqual(config);
  expect(
    verifierProductionConfig.safeParse({ ...config, port: 0 }).success
  ).toBe(false);
});
