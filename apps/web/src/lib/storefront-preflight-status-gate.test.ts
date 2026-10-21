import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  context,
  expectFailOpenReason,
  expectSkipReason,
} from './storefront-preflight-rpc.test-utils';
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
});
