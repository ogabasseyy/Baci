import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  context,
  expectFailOpenReason,
  expectSkipReason,
} from './storefront-preflight-rpc.test-utils';
import type { StorefrontPreflightRpcAttempt } from './storefront-preflight-rpc-attempt';
import { gateStorefrontPreflightStatus } from './storefront-preflight-status-gate';

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

describe('gateStorefrontPreflightStatus', () => {
  beforeEach(() => {
    consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true and logs nothing for a published storefront', () => {
    const result = gateStorefrontPreflightStatus('published', context());

    expect(result).toBe(true);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it.each([
    'unknown',
    'unpublished',
  ])('returns false and logs a skip for %s status', (status) => {
    const result = gateStorefrontPreflightStatus(status, context());

    expect(result).toBe(false);
    expectSkipReason(consoleWarnSpy, 'unknown-storefront');
  });

  it('returns false and captures a fail-open for any other status value', () => {
    const result = gateStorefrontPreflightStatus(
      'weird-future-value',
      context()
    );

    expect(result).toBe(false);
    expectFailOpenReason(consoleWarnSpy, 'has-error');
  });

  it('correlates the has-error capture with the producing attempt when known', () => {
    const attempt: StorefrontPreflightRpcAttempt = {
      attemptId: 'b2db3763-0bca-4bfb-b7eb-c53041ad9a45',
      deadlineMs: 4_000,
      elapsedMs: 12,
      outcome: 'success',
      rpcName: 'fn',
      surface: 'product-slug',
    };

    const result = gateStorefrontPreflightStatus(
      'weird-future-value',
      context(),
      attempt
    );

    expect(result).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({
        reason: 'has-error',
        outcome: 'parse-error',
        attemptId: 'b2db3763-0bca-4bfb-b7eb-c53041ad9a45',
      })
    );
  });
});
