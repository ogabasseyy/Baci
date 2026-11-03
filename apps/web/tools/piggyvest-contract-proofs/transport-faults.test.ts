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
});
