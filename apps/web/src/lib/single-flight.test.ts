import { describe, expect, it, vi } from 'vitest';
import { SingleFlight } from './single-flight';

describe('SingleFlight', () => {
  it('allows a fresh read after an in-flight key is forgotten', async () => {
    const reads = new SingleFlight<string>();
    let resolveFirst: ((value: string) => void) | undefined;
    const first = reads.run(
      'merchant',
      () => new Promise<string>((resolve) => (resolveFirst = resolve))
    );
    await Promise.resolve();

    reads.forget('merchant');
    const second = reads.run('merchant', () => Promise.resolve('fresh'));
    resolveFirst?.('stale');

    await expect(first).resolves.toBe('stale');
    await expect(second).resolves.toBe('fresh');
  });

  it('shares concurrent work and forgets it after settlement', async () => {
    let resolve: ((value: string) => void) | undefined;
    const providerRead = new Promise<string>((done) => {
      resolve = done;
    });
    const load = vi.fn(() => providerRead);
    const reads = new SingleFlight<string>();

    const first = reads.run('store', load);
    const second = reads.run('store', load);
    resolve?.('ogabassey');

    await expect(Promise.all([first, second])).resolves.toEqual([
      'ogabassey',
      'ogabassey',
    ]);
    expect(load).toHaveBeenCalledTimes(1);

    const third = reads.run('store', () => 'fresh');
    await expect(third).resolves.toBe('fresh');
  });

  it('retries after a rejected shared operation', async () => {
    const reads = new SingleFlight<string>();
    const failed = reads.run('store', () =>
      Promise.reject(new Error('outage'))
    );

    await expect(failed).rejects.toThrow('outage');
    await expect(reads.run('store', () => 'recovered')).resolves.toBe(
      'recovered'
    );
  });

  it('does not retain excess unique work beyond its bound', async () => {
    const reads = new SingleFlight<string>(1);
    let resolveFirst: ((value: string) => void) | undefined;
    const firstRead = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const first = reads.run('first', () => firstRead);
    const excessLoad = vi.fn(() => Promise.resolve('second'));

    await Promise.all([
      reads.run('second', excessLoad),
      reads.run('second', excessLoad),
    ]);
    expect(excessLoad).toHaveBeenCalledTimes(2);

    resolveFirst?.('first');
    await expect(first).resolves.toBe('first');
  });
});
