import { describe, expect, it } from 'vitest';
import { ogabasseyCwvNetwork } from './measure-ogabassey-cwv-network-utils.mjs';

const { resolveCanonicalUrlOrFailure } = ogabasseyCwvNetwork;

describe('resolveCanonicalUrlOrFailure', () => {
  it('records canonical lookup failures without discarding the requested PDP URL', async () => {
    await expect(
      resolveCanonicalUrlOrFailure('https://ogabassey.com/products/source', {
        label: 'custom-pdp',
        resolveCanonicalUrlImpl: () => {
          throw new Error('canonical lookup failed');
        },
      })
    ).resolves.toEqual({
      failure: {
        label: 'custom-pdp',
        message: 'canonical lookup failed',
        source: 'target-resolution',
      },
      url: 'https://ogabassey.com/products/source',
    });
  });
});
