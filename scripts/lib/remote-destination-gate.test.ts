import { describe, expect, it, vi } from 'vitest';
import { Dispatcher } from 'undici';
import {
  createPinnedLookup,
  type DestinationLookupFn,
  resolvePinnedDestination,
} from './remote-destination-gate';

const publicLookup: DestinationLookupFn = async () => [
  { address: '93.184.216.1', family: 4 },
];

describe('resolvePinnedDestination', () => {
  it('pins the first public address behind a dispatcher', async () => {
    const gate = await resolvePinnedDestination(
      'https://images.example.com/phone.jpg',
      publicLookup
    );
    expect('failure' in gate).toBe(false);
    if ('failure' in gate) return;
    expect(gate.address).toBe('93.184.216.1');
    expect(gate.family).toBe(4);
    expect(gate.dispatcher).toBeInstanceOf(Dispatcher);
    await gate.dispatcher.close();
  });

  it('skips private answers and pins the first public one', async () => {
    const lookup: DestinationLookupFn = async () => [
      { address: '10.0.0.5', family: 4 },
      { address: '93.184.216.2', family: 4 },
    ];
    const gate = await resolvePinnedDestination(
      'https://images.example.com/phone.jpg',
      lookup
    );
    expect('failure' in gate).toBe(false);
    if ('failure' in gate) return;
    expect(gate.address).toBe('93.184.216.2');
    await gate.dispatcher.close();
  });

  it('rejects destinations whose addresses are all non-public', async () => {
    const lookup: DestinationLookupFn = async () => [
      { address: '10.0.0.5', family: 4 },
    ];
    const gate = await resolvePinnedDestination(
      'https://images.example.com/phone.jpg',
      lookup
    );
    expect(gate).toEqual({
      failure:
        'Rejected remote image destination: images.example.com resolves to non-public address 10.0.0.5',
      retryable: false,
    });
  });

  it('passes the unbracketed hostname to the resolver', async () => {
    const seen: string[] = [];
    const lookup: DestinationLookupFn = async (hostname) => {
      seen.push(hostname);
      return [{ address: '2001:db8::1', family: 6 }];
    };
    const gate = await resolvePinnedDestination(
      'http://[2001:db8::1]/p.jpg',
      lookup
    );
    expect(seen).toEqual(['2001:db8::1']);
    expect('failure' in gate).toBe(false);
    if ('failure' in gate) return;
    expect(gate.address).toBe('2001:db8::1');
    await gate.dispatcher.close();
  });

  it('exposes every validated address for connection fallback', async () => {
    const lookup: DestinationLookupFn = async () => [
      { address: '2001:db8::2', family: 6 },
      { address: '93.184.216.3', family: 4 },
    ];
    const gate = await resolvePinnedDestination(
      'https://images.example.com/phone.jpg',
      lookup
    );
    expect('failure' in gate).toBe(false);
    if ('failure' in gate) return;
    // The reported pin stays the first validated address.
    expect(gate.address).toBe('2001:db8::2');
    await gate.dispatcher.close();

    const pinned = createPinnedLookup([
      { address: '2001:db8::2', family: 6 },
      { address: '93.184.216.3', family: 4 },
    ]);
    const all = await new Promise((resolve, reject) =>
      pinned('images.example.com', { all: true }, (err, address) =>
        err ? reject(err) : resolve(address)
      )
    );
    // Family autoselection receives the full validated set, never a
    // re-resolved hostname, so the transport can fall back across records.
    expect(all).toEqual([
      { address: '2001:db8::2', family: 6 },
      { address: '93.184.216.3', family: 4 },
    ]);
    const one = await new Promise((resolve, reject) =>
      pinned('images.example.com', {}, (err, address, family) =>
        err ? reject(err) : resolve({ address, family })
      )
    );
    expect(one).toEqual({ address: '2001:db8::2', family: 6 });
  });

  it('leaves DNS failures retryable', async () => {
    const lookup: DestinationLookupFn = async () => {
      throw new Error('ENOTFOUND');
    };
    const gate = await resolvePinnedDestination(
      'https://images.example.com/phone.jpg',
      lookup
    );
    expect(gate).toEqual({
      failure: 'DNS resolution failed for images.example.com',
      retryable: true,
    });
  });

  it('rejects invalid URLs without resolving', async () => {
    const lookup = vi.fn<DestinationLookupFn>(publicLookup);
    const gate = await resolvePinnedDestination(
      'http://169.254.169.254/x.jpg',
      lookup
    );
    expect(gate).toEqual({
      failure:
        'Rejected remote image destination: http://169.254.169.254/x.jpg',
      retryable: false,
    });
    expect(lookup).not.toHaveBeenCalled();
  });
});
