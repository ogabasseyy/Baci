import { describe, expect, it, vi } from 'vitest';
import {
  SAVINGS_VERIFY_RETRY_BUDGET_MS,
  SAVINGS_VERIFY_RETRY_DELAYS_MS,
  withSavingsVerifyRetry,
} from './primary-wallet-savings-verify-retry';

const selection = { reference: 'pvb-save-reference', walletId: 'source' };

function record(status: 'pending' | 'successful' | 'failed' | 'success') {
  return {
    status: true,
    data: {
      status,
      id: 'transaction',
      internal_reference: 'transaction',
      reference: 'provider-reference',
      third_party_reference: selection.reference,
      amount: 2000,
      fee: 0,
      customer_id: 'source-customer',
      source_wallet: 'source',
      destination_wallet: 'destination',
    },
  };
}

function notFound() {
  return Object.assign(new Error('PROVIDER_HTTP_ERROR'), { httpStatus: 404 });
}

function clock() {
  let time = 0;
  return {
    now: () => time,
    sleep: vi.fn(async (ms: number) => {
      time += ms;
    }),
  };
}

describe('withSavingsVerifyRetry', () => {
  it('returns the terminal record once a pending one settles on a re-ask', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(record('pending'))
      .mockResolvedValueOnce(record('pending'))
      .mockResolvedValueOnce(record('successful'));
    const { now, sleep } = clock();
    const response = await withSavingsVerifyRetry(query, { now, sleep })(
      selection
    );
    expect(response).toEqual(record('successful'));
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenCalledWith(selection);
    expect(sleep.mock.calls).toEqual([[1500], [2000]]);
  });

  it('re-asks after a not-indexed-yet 404', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce(record('successful'));
    const { now, sleep } = clock();
    expect(
      await withSavingsVerifyRetry(query, { now, sleep })(selection)
    ).toEqual(record('successful'));
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('passes the last non-terminal answer through after the bounded tries', async () => {
    const query = vi.fn().mockResolvedValue(record('pending'));
    const { now, sleep } = clock();
    expect(
      await withSavingsVerifyRetry(query, { now, sleep })(selection)
    ).toEqual(record('pending'));
    expect(query).toHaveBeenCalledTimes(
      SAVINGS_VERIFY_RETRY_DELAYS_MS.length + 1
    );
    const waited = sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0);
    expect(waited).toBe(5500);
    expect(waited).toBeLessThanOrEqual(SAVINGS_VERIFY_RETRY_BUDGET_MS);
  });

  it('rethrows the last 404 after the bounded tries', async () => {
    const query = vi.fn().mockRejectedValue(notFound());
    const { now, sleep } = clock();
    await expect(
      withSavingsVerifyRetry(query, { now, sleep })(selection)
    ).rejects.toThrow('PROVIDER_HTTP_ERROR');
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('does not re-ask a terminal failed record', async () => {
    const query = vi.fn().mockResolvedValue(record('failed'));
    const { now, sleep } = clock();
    expect(
      await withSavingsVerifyRetry(query, { now, sleep })(selection)
    ).toEqual(record('failed'));
    expect(query).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not re-ask a malformed body: it is not lag', async () => {
    const query = vi.fn().mockResolvedValue({ status: true, data: {} });
    const { now, sleep } = clock();
    expect(
      await withSavingsVerifyRetry(query, { now, sleep })(selection)
    ).toEqual({ status: true, data: {} });
    expect(query).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not re-ask a timeout or other provider error', async () => {
    const query = vi.fn().mockRejectedValue(new Error('PROVIDER_TIMEOUT'));
    const { now, sleep } = clock();
    await expect(
      withSavingsVerifyRetry(query, { now, sleep })(selection)
    ).rejects.toThrow('PROVIDER_TIMEOUT');
    expect(query).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops re-asking once slow answers use up the time budget', async () => {
    const { now, sleep } = clock();
    let time = 0;
    const slowNow = () => now() + time;
    const query = vi.fn(async () => {
      time += 4000; // each provider answer takes 4 s
      return record('pending');
    });
    expect(
      await withSavingsVerifyRetry(query, { now: slowNow, sleep })(selection)
    ).toEqual(record('pending'));
    // 4 s answer + 1.5 s wait fits 8 s; after the second answer (9.5 s) no
    // further try starts.
    expect(query).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('honours injected delays as the attempt bound', async () => {
    const query = vi.fn().mockResolvedValue(record('pending'));
    const { now, sleep } = clock();
    await withSavingsVerifyRetry(query, { now, sleep, delaysMs: [10] })(
      selection
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[10]]);
  });

  it("does not re-ask a 'success' record: the proof never settles it", async () => {
    const query = vi.fn().mockResolvedValue(record('success'));
    const { now, sleep } = clock();
    expect(
      await withSavingsVerifyRetry(query, { now, sleep })(selection)
    ).toEqual(record('success'));
    expect(query).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('starts no try when a late timer overran the budget', async () => {
    let time = 0;
    const now = () => time;
    // The first wait should take 1.5 s but the timer fires 10 s late.
    const sleep = vi.fn(async (ms: number) => {
      time += ms + 10_000;
    });
    const query = vi.fn().mockResolvedValue(record('pending'));
    expect(
      await withSavingsVerifyRetry(query, { now, sleep })(selection)
    ).toEqual(record('pending'));
    expect(query).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('rethrows a 404 without a new try when a late timer overran the budget', async () => {
    let time = 0;
    const now = () => time;
    const sleep = vi.fn(async (ms: number) => {
      time += ms + 10_000;
    });
    const query = vi.fn().mockRejectedValue(notFound());
    await expect(
      withSavingsVerifyRetry(query, { now, sleep })(selection)
    ).rejects.toThrow('PROVIDER_HTTP_ERROR');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
