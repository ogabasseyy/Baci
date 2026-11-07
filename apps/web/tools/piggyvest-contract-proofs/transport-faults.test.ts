import { describe, expect, it, vi } from 'vitest';
import { TransportFaults } from './transport-faults';

const reply = () => new Response('{}', { status: 202 });

describe('TransportFaults', () => {
  it('passes everything through when nothing is armed', async () => {
    const base = vi.fn(async () => reply());
    const wrapped = new TransportFaults().wrap(base as unknown as typeof fetch);
    const response = await wrapped('https://x.test/api/v1/transfer/wallet', {
      method: 'POST',
    });
    expect(response.status).toBe(202);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('lets the armed request reach the provider, then loses its response, once', async () => {
    const base = vi.fn(async () => reply());
    const faults = new TransportFaults();
    const wrapped = faults.wrap(base as unknown as typeof fetch);
    faults.loseNextResponse('/api/v1/transfer/wallet');
    await expect(
      wrapped('https://x.test/api/v1/transfer/wallet', { method: 'POST' })
    ).rejects.toThrow(TypeError);
    expect(base).toHaveBeenCalledTimes(1);
    const again = await wrapped('https://x.test/api/v1/transfer/wallet', {
      method: 'POST',
    });
    expect(again.status).toBe(202);
    expect(base).toHaveBeenCalledTimes(2);
    expect(faults.pending()).toBe(0);
  });

  it('ignores reads and other paths, keeping the fault armed', async () => {
    const base = vi.fn(async () => reply());
    const faults = new TransportFaults();
    const wrapped = faults.wrap(base as unknown as typeof fetch);
    faults.loseNextResponse('/api/v1/transfer/wallet');
    await wrapped('https://x.test/api/v1/transfer/wallet?x=1', {
      method: 'GET',
    });
    await wrapped('https://x.test/api/v1/transfer/bank', { method: 'POST' });
    expect(faults.pending()).toBe(1);
  });

  it('can be disarmed', async () => {
    const faults = new TransportFaults();
    faults.loseNextResponse('/api/v1/transfer/wallet');
    faults.clear();
    expect(faults.pending()).toBe(0);
  });

  it('claims each fault synchronously, so concurrent POSTs never share or misplace one', async () => {
    const releases: Array<() => void> = [];
    const base = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(reply()));
        })
    );
    const faults = new TransportFaults();
    const wrapped = faults.wrap(base as unknown as typeof fetch);
    faults.loseNextResponse('/transfer/a');
    faults.loseNextResponse('/transfer/b');
    const toA = wrapped('https://x.test/transfer/a', { method: 'POST' });
    const toB = wrapped('https://x.test/transfer/b', { method: 'POST' });
    const settled = Promise.allSettled([toA, toB]);
    // Resolve in the opposite order to the arming order.
    releases[0]?.();
    releases[1]?.();
    const [a, b] = await settled;
    expect(a?.status).toBe('rejected');
    expect(b?.status).toBe('rejected');
    expect(faults.pending()).toBe(0);
  });

  it('applies one armed fault to only one of two concurrent identical POSTs', async () => {
    const base = vi.fn(async () => reply());
    const faults = new TransportFaults();
    const wrapped = faults.wrap(base as unknown as typeof fetch);
    faults.loseNextResponse('/transfer/a');
    const results = await Promise.allSettled([
      wrapped('https://x.test/transfer/a', { method: 'POST' }),
      wrapped('https://x.test/transfer/a', { method: 'POST' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(faults.pending()).toBe(0);
  });

  it('reads the method from a Request input when init has none', async () => {
    const base = vi.fn(async () => reply());
    const faults = new TransportFaults();
    const wrapped = faults.wrap(base as unknown as typeof fetch);
    faults.loseNextResponse('/api/v1/transfer/wallet');
    await expect(
      wrapped(
        new Request('https://x.test/api/v1/transfer/wallet', { method: 'POST' })
      )
    ).rejects.toThrow(TypeError);
    expect(faults.pending()).toBe(0);
  });

  it('does not claim the fault for a GET Request input', async () => {
    const base = vi.fn(async () => reply());
    const faults = new TransportFaults();
    const wrapped = faults.wrap(base as unknown as typeof fetch);
    faults.loseNextResponse('/api/v1/transfer/wallet');
    await wrapped(new Request('https://x.test/api/v1/transfer/wallet'));
    expect(faults.pending()).toBe(1);
  });

  it('cancels the unconsumed body of the lost response', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    const base = vi.fn(async () => new Response(body, { status: 202 }));
    const faults = new TransportFaults();
    const wrapped = faults.wrap(base as unknown as typeof fetch);
    faults.loseNextResponse('/api/v1/transfer/wallet');
    await expect(
      wrapped('https://x.test/api/v1/transfer/wallet', { method: 'POST' })
    ).rejects.toThrow(TypeError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
