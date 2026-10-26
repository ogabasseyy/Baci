import { describe, expect, it } from 'vitest';
import { classifyStorefrontPreflightRpcOutcome } from './storefront-preflight-rpc-outcome';

describe('classifyStorefrontPreflightRpcOutcome', () => {
  it('labels Postgres 57014 as database-timeout on any reason', () => {
    expect(classifyStorefrontPreflightRpcOutcome('timeout', '57014')).toBe(
      'database-timeout'
    );
    expect(classifyStorefrontPreflightRpcOutcome('has-error', '57014')).toBe(
      'database-timeout'
    );
    expect(
      classifyStorefrontPreflightRpcOutcome('fetch-error', '  57014  ')
    ).toBe('database-timeout');
  });

  it('labels client aborts without a 57014 code as client-timeout', () => {
    expect(classifyStorefrontPreflightRpcOutcome('timeout')).toBe(
      'client-timeout'
    );
    expect(classifyStorefrontPreflightRpcOutcome('timeout', 'XX000')).toBe(
      'client-timeout'
    );
  });

  it('passes through fetch-error and defaults everything else to rpc-error', () => {
    expect(classifyStorefrontPreflightRpcOutcome('fetch-error')).toBe(
      'fetch-error'
    );
    expect(classifyStorefrontPreflightRpcOutcome('has-error')).toBe(
      'rpc-error'
    );
    expect(classifyStorefrontPreflightRpcOutcome('has-error', '42P01')).toBe(
      'rpc-error'
    );
  });
});
