import { describe, expect, it, vi } from 'vitest';
import { prepareStorefrontSingleAttemptQuery } from './prepare-storefront-single-attempt-query';

describe('prepareStorefrontSingleAttemptQuery', () => {
  it('composes the abort signal and disables SDK retries', async () => {
    const result = { data: [], error: null };
    const query = Object.assign(Promise.resolve(result), {
      abortSignal: vi.fn(),
      retry: vi.fn(),
    });
    query.abortSignal.mockReturnValue(query);
    query.retry.mockReturnValue(query);
    const signal = new AbortController().signal;

    await prepareStorefrontSingleAttemptQuery(query, signal);

    expect(query.abortSignal).toHaveBeenCalledWith(signal);
    expect(query.retry).toHaveBeenCalledWith(false);
  });

  it('returns the original query when abortSignal and retry are unavailable', async () => {
    const query = Promise.resolve({ data: [], error: null });
    await expect(
      prepareStorefrontSingleAttemptQuery(query, new AbortController().signal)
    ).resolves.toEqual({ data: [], error: null });
  });

  it('disables retries when abortSignal is unavailable', async () => {
    const result = { data: [], error: null };
    const query = Object.assign(Promise.resolve(result), {
      retry: vi.fn(() => Promise.resolve(result)),
    });

    await expect(
      prepareStorefrontSingleAttemptQuery(query, new AbortController().signal)
    ).resolves.toBe(result);
    expect(query.retry).toHaveBeenCalledWith(false);
  });

  it('returns the abortable query when retry is unavailable', async () => {
    const result = { data: [], error: null };
    const abortable = Promise.resolve(result);
    const query = Object.assign(Promise.resolve(result), {
      abortSignal: vi.fn(() => abortable),
    });

    await expect(
      prepareStorefrontSingleAttemptQuery(query, new AbortController().signal)
    ).resolves.toBe(result);
    expect(query.abortSignal).toHaveBeenCalled();
  });
});
