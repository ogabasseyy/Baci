import { describe, expect, it } from 'vitest';
import { parseBuilderProductionConfig } from './production-config';

const key = (n: number) => Buffer.alloc(32, n).toString('base64url');
const valid = () => ({
  port: 43100,
  deliveryPort: 43101,
  authPort: 43103,
  verifierPort: 43102,
  verifierKey: key(1),
  previewKey: key(2),
  buildKey: key(3),
  runner: {
    endpoint: 'https://runner.example.com/v1/execute',
    key: key(4),
    toolchainDigest: 'a'.repeat(64),
  },
  previewDatabaseUrl:
    'postgresql://baci_owner_preview_login:secret@db.example.com:5432/postgres',
  hostOrigin: 'https://preview.example.com',
  executionOrigin: 'https://execution.other-example.com',
  rootDomain: 'example.com',
  supabase: {
    url: 'https://project.supabase.co',
    anonKey: 'sb_publishable_12345678',
  },
});

describe('private builder operator configuration', () => {
  it('accepts a bounded configuration and decodes distinct keys', () => {
    const result = parseBuilderProductionConfig(valid());
    expect(result.verifierKey).toEqual(Buffer.alloc(32, 1));
    expect(result.runner.key).toEqual(Buffer.alloc(32, 4));
    expect(result.artifactDirectory).toBe('/var/lib/baci-builder/artifacts');
  });

  it.each([
    { verifierPort: 43100 },
    { authPort: 43100 },
    { verifierKey: key(2) },
    { buildKey: key(4) },
    {
      previewDatabaseUrl:
        'postgresql://postgres:secret@db.example.com/postgres',
    },
    {
      previewDatabaseUrl:
        'postgresql://baci_owner_preview_login:secret@db.example.com/postgres?sslmode=disable',
    },
    { executionOrigin: 'http://execution.example.com' },
    {
      runner: {
        endpoint: 'https://127.0.0.1/v1/execute',
        key: key(4),
        toolchainDigest: 'a'.repeat(64),
      },
    },
    {
      supabase: {
        url: 'https://project.supabase.co',
        anonKey: 'service_role_secret',
      },
    },
    { artifactDirectory: '/tmp/untrusted' },
  ])('rejects unsafe configuration without exposing details: %o', (change) => {
    expect(() =>
      parseBuilderProductionConfig({ ...valid(), ...change })
    ).toThrow('INVALID_BUILDER_CONFIG');
  });
});
