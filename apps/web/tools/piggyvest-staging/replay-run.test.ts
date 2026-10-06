import { describe, expect, it, vi } from 'vitest';
import {
  assertSystemIdentifier,
  isAllowedStagingOrigin,
  parseReplayEnvironment,
  validateReplayDatabaseIdentities,
} from './replay-run';

const identity = (value: unknown) =>
  ({
    rpc: vi.fn(async () => ({ data: value, error: null })),
  }) as never;

const environment = {
  PVB_STAGING_REPLAY_ENABLED: '1',
  PVB_STAGING_POSTGREST_URL: 'http://127.0.0.1:3005/rest/v1',
  PVB_STAGING_WORKER_JWT: 'worker-token',
  PVB_STAGING_APP_URL: 'http://127.0.0.1:3006',
  PVB_STAGING_APP_KEY: 'app-key',
  PVB_STAGING_RECEIPT_KEY_B64: Buffer.alloc(32, 1).toString('base64'),
  PVB_STAGING_ALLOWED_ORIGINS: '',
  PVB_STAGING_EXPECTED_SYSTEM_ID: '7684917650710224934',
  PVB_STAGING_EXPECTED_APP_SYSTEM_ID: '7684917650710224935',
  NODE_ENV: 'development',
};

describe('replay activation identity pins', () => {
  it.each([
    'PVB_STAGING_EXPECTED_SYSTEM_ID',
    'PVB_STAGING_EXPECTED_APP_SYSTEM_ID',
  ])('requires %s', (pin) => {
    const missing: Record<string, string> = { ...environment };
    delete missing[pin];

    expect(() => parseReplayEnvironment(missing)).toThrow(pin);
  });

  it('refuses a wrong app identity without allowing a claim', async () => {
    const claim = vi.fn();

    await expect(
      validateReplayDatabaseIdentities(
        identity(environment.PVB_STAGING_EXPECTED_SYSTEM_ID),
        identity('wrong-app-system-id'),
        environment.PVB_STAGING_EXPECTED_SYSTEM_ID,
        environment.PVB_STAGING_EXPECTED_APP_SYSTEM_ID
      )
    ).rejects.toThrow(/does not match/);

    expect(claim).not.toHaveBeenCalled();
  });

  it('validates both identities before the claim gate opens', async () => {
    const claim = vi.fn();

    await validateReplayDatabaseIdentities(
      identity(environment.PVB_STAGING_EXPECTED_SYSTEM_ID),
      identity(environment.PVB_STAGING_EXPECTED_APP_SYSTEM_ID),
      environment.PVB_STAGING_EXPECTED_SYSTEM_ID,
      environment.PVB_STAGING_EXPECTED_APP_SYSTEM_ID
    );
    claim();

    expect(claim).toHaveBeenCalledOnce();
  });
});

describe('isAllowedStagingOrigin', () => {
  it('allows loopback http with ports and paths', () => {
    expect(isAllowedStagingOrigin('http://localhost:3006/rest/v1', [])).toBe(
      true
    );
    expect(isAllowedStagingOrigin('http://127.0.0.1:3005/', [])).toBe(true);
  });

  it('refuses arbitrary https without an allowlist', () => {
    expect(
      isAllowedStagingOrigin('https://staging.example.com/rest/v1', [])
    ).toBe(false);
  });

  it('allows exact allowlist matches, ignoring case and entry slashes', () => {
    const allowed = [
      'https://staging.example.com/',
      'https://db.internal:8443',
    ];
    expect(
      isAllowedStagingOrigin('https://staging.example.com/rest/v1', allowed)
    ).toBe(true);
    expect(
      isAllowedStagingOrigin('https://DB.INTERNAL:8443/rpc/x', allowed)
    ).toBe(true);
  });

  it('refuses lookalike and smuggled origins', () => {
    const allowed = ['https://staging.example.com'];
    expect(
      isAllowedStagingOrigin('https://staging.example.com.evil.com/', allowed)
    ).toBe(false);
    expect(
      isAllowedStagingOrigin('https://evil.com/?x=staging.example.com', allowed)
    ).toBe(false);
    expect(isAllowedStagingOrigin('http://localhost.evil.com/', allowed)).toBe(
      false
    );
    expect(isAllowedStagingOrigin('http://127.0.0.1.evil.com/', allowed)).toBe(
      false
    );
  });

  it('refuses credentials, unknown schemes and garbage', () => {
    const allowed = ['https://staging.example.com'];
    expect(
      isAllowedStagingOrigin('https://user:pass@staging.example.com/', allowed)
    ).toBe(false);
    expect(isAllowedStagingOrigin('ftp://staging.example.com/', allowed)).toBe(
      false
    );
    expect(isAllowedStagingOrigin('not-a-url', allowed)).toBe(false);
    expect(
      isAllowedStagingOrigin('https://staging.example.com', ['garbage'])
    ).toBe(false);
  });
});

describe('assertSystemIdentifier', () => {
  it('accepts the exact pinned identity', () => {
    expect(() =>
      assertSystemIdentifier('7684917650710224934', '7684917650710224934')
    ).not.toThrow();
  });

  it('refuses a different database, null, or wrong types', () => {
    expect(() =>
      assertSystemIdentifier('7684917650710224935', '7684917650710224934')
    ).toThrow(/does not match/);
    expect(() => assertSystemIdentifier(null, '7684917650710224934')).toThrow(
      /does not match/
    );
    expect(() =>
      assertSystemIdentifier(42 as unknown as string, '7684917650710224934')
    ).toThrow(/does not match/);
  });
});
