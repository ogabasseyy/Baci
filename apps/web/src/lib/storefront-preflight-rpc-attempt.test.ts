import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorefrontPreflightRpcAttemptRecorder } from './storefront-preflight-rpc-attempt';

describe('createStorefrontPreflightRpcAttemptRecorder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('logs one bounded attempt record and returns the attempt', () => {
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const recordAttempt = createStorefrontPreflightRpcAttemptRecorder({
      deadlineMs: 4_000,
      rpcName: 'fn',
      surface: 'blog-post-status',
    });

    const attempt = recordAttempt('success');

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      '[storefront-preflight-rpc] attempt',
      expect.objectContaining({
        attempt_id: attempt.attemptId,
        deadline_ms: 4_000,
        elapsed_ms: expect.any(Number),
        outcome: 'success',
        rpc_name: 'fn',
        surface: 'blog-post-status',
      })
    );
    expect(attempt.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('falls back to a counter ID when crypto.randomUUID is unavailable', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('crypto', undefined);

    const recordAttempt = createStorefrontPreflightRpcAttemptRecorder({
      deadlineMs: 4_000,
      rpcName: 'fn',
      surface: 'blog-post-status',
    });

    expect(recordAttempt('success').attemptId).toMatch(
      /^preflight-fallback-\d+$/
    );
  });

  it('falls back to a counter ID when crypto.randomUUID throws', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('denied');
      },
    });

    const recordAttempt = createStorefrontPreflightRpcAttemptRecorder({
      deadlineMs: 4_000,
      rpcName: 'fn',
      surface: 'blog-post-status',
    });

    expect(recordAttempt('success').attemptId).toMatch(
      /^preflight-fallback-\d+$/
    );
  });

  it('survives performance.now throwing (never-throws contract)', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('no clock');
    });

    const recordAttempt = createStorefrontPreflightRpcAttemptRecorder({
      deadlineMs: 4_000,
      rpcName: 'fn',
      surface: 'blog-post-status',
    });

    expect(() => recordAttempt('success')).not.toThrow();
  });

  it('swallows console.info failures without changing the attempt', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('log sink down');
    });
    const recordAttempt = createStorefrontPreflightRpcAttemptRecorder({
      deadlineMs: 4_000,
      rpcName: 'fn',
      surface: 'blog-post-status',
    });

    const attempt = recordAttempt('fetch-error');

    expect(attempt.outcome).toBe('fetch-error');
    expect(attempt.rpcName).toBe('fn');
  });
});
