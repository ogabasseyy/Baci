import { afterEach, describe, expect, it, vi } from 'vitest';
import { remainingVerificationSignal } from './remaining-verification-signal';

describe('remainingVerificationSignal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('leaves the provider read unbounded when the worker has no deadline', () => {
    expect(remainingVerificationSignal(undefined)).toBeUndefined();
  });

  it('does not start another provider read after the deadline', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    expect(remainingVerificationSignal(100)).toBeNull();
  });

  it('bounds a provider read by the remaining worker time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    expect(remainingVerificationSignal(150)).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(50);
  });
});
