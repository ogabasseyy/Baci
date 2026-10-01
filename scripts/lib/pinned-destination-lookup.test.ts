import { describe, expect, it } from 'vitest';
import { createPinnedLookup } from './pinned-destination-lookup';

describe('createPinnedLookup', () => {
  it('exposes every validated address for connection fallback', async () => {
    const pinned = createPinnedLookup([
      { address: '2606:4700:4700::2222', family: 6 },
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
      { address: '2606:4700:4700::2222', family: 6 },
      { address: '93.184.216.3', family: 4 },
    ]);
  });

  it('returns the first pinned address for single-address callers', async () => {
    const pinned = createPinnedLookup([
      { address: '2606:4700:4700::2222', family: 6 },
      { address: '93.184.216.3', family: 4 },
    ]);
    const one = await new Promise((resolve, reject) =>
      pinned('images.example.com', {}, (err, address, family) =>
        err ? reject(err) : resolve({ address, family })
      )
    );
    expect(one).toEqual({ address: '2606:4700:4700::2222', family: 6 });
  });
});
