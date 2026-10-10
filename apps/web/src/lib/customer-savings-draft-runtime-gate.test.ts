import { describe, expect, it } from 'vitest';
import { customerSavingsDraftRuntimeEnabled } from './customer-savings-draft-runtime-gate';

const stagingRuntime = {
  requestOrigin: 'https://staging.ogabassey.com',
  nodeEnv: 'production',
  supabaseUrl: 'https://staging-auth.ogabassey.com',
  supabaseAnonKeySha256:
    '1065d3a5c300f1d3ba3d6c42cbe0524128c57cc2032a4345bff4100cb6f7a3f2',
  stagingEnabled: 'true',
};

describe('customer savings draft runtime gate', () => {
  it('accepts the exact service-confirmed loopback origin behind the isolated staging proxy', () => {
    expect(
      customerSavingsDraftRuntimeEnabled({
        ...stagingRuntime,
        requestOrigin: 'https://localhost:4792',
        workerProfile: 'hosted-savings-drafts',
        host: 'staging.ogabassey.com',
        forwardedHost: 'staging.ogabassey.com',
        forwardedProto: 'https',
      })
    ).toBe(true);
  });

  it.each([
    { workerProfile: undefined },
    { host: 'evil.example' },
    { forwardedHost: 'evil.example' },
    { forwardedProto: 'http' },
    { requestOrigin: 'https://127.0.0.1' },
    { requestOrigin: 'https://127.0.0.1:4792' },
    { requestOrigin: 'https://127.0.0.1:4793' },
    { requestOrigin: 'http://127.0.0.1' },
    { requestOrigin: 'https://localhost' },
    { requestOrigin: 'https://localhost:4793' },
    { requestOrigin: 'http://localhost:4792' },
    { requestOrigin: 'https://127.0.0.2' },
    { requestOrigin: 'https://evil.example' },
    { supabaseAnonKeySha256: 'wrong' },
  ])('rejects untrusted proxy transport %j', (change) => {
    expect(
      customerSavingsDraftRuntimeEnabled({
        ...stagingRuntime,
        requestOrigin: 'https://localhost:4792',
        workerProfile: 'hosted-savings-drafts',
        host: 'staging.ogabassey.com',
        forwardedHost: 'staging.ogabassey.com',
        forwardedProto: 'https',
        ...change,
      })
    ).toBe(false);
  });

  it('permits the existing non-production loopback runtime', () => {
    expect(
      customerSavingsDraftRuntimeEnabled({
        ...stagingRuntime,
        requestOrigin: 'http://localhost:3000',
        nodeEnv: 'test',
        supabaseUrl: 'http://127.0.0.1:55431',
        stagingEnabled: undefined,
      })
    ).toBe(true);
  });

  it('permits only the fully pinned hosted staging runtime', () => {
    expect(customerSavingsDraftRuntimeEnabled(stagingRuntime)).toBe(true);
  });

  it.each([
    [
      'request origin',
      { requestOrigin: 'https://staging.ogabassey.com.evil.test' },
    ],
    ['Supabase URL', { supabaseUrl: 'https://staging-auth.ogabassey.com/' }],
    ['anon key', { supabaseAnonKeySha256: 'different-key-hash' }],
    ['integration flag', { stagingEnabled: '1' }],
    ['missing integration flag', { stagingEnabled: undefined }],
  ])('refuses hosted staging with a changed %s', (_label, change) => {
    expect(
      customerSavingsDraftRuntimeEnabled({ ...stagingRuntime, ...change })
    ).toBe(false);
  });

  it('does not treat production NODE_ENV as deployment identity', () => {
    expect(
      customerSavingsDraftRuntimeEnabled({
        ...stagingRuntime,
        requestOrigin: 'http://127.0.0.1:3000',
        supabaseUrl: 'http://127.0.0.1:55431',
      })
    ).toBe(false);
  });
});
