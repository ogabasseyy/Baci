import { describe, expect, it } from 'vitest';
import { MockR2Bucket } from './mock-r2';

describe('MockR2Bucket conditional writes and etag contracts', () => {
  it('makes concurrent etagDoesNotMatch create-only puts atomic', async () => {
    const bucket = new MockR2Bucket();
    const slowStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await Promise.resolve();
        controller.enqueue(new TextEncoder().encode('first'));
        controller.close();
      },
    });

    const [first, second] = await Promise.all([
      bucket.put('race/key.json', slowStream, {
        onlyIf: { etagDoesNotMatch: '*' },
      }),
      bucket.put('race/key.json', 'second', {
        onlyIf: { etagDoesNotMatch: '*' },
      }),
    ]);

    const successes = [first, second].filter((item) => item !== null);
    expect(successes).toHaveLength(1);
  });

  it('accepts unquoted etag and rejects quoted httpEtag in onlyIf.etagMatches', async () => {
    const bucket = new MockR2Bucket();
    const created = await bucket.put('ptr.json', 'v1');
    expect(created?.etag).toBeTruthy();
    expect(created?.httpEtag).toBe(`"${created?.etag}"`);

    await expect(
      bucket.put('ptr.json', 'v2', {
        onlyIf: { etagMatches: created?.httpEtag },
      })
    ).rejects.toThrow(/unquoted etag/);

    const updated = await bucket.put('ptr.json', 'v2', {
      onlyIf: { etagMatches: created?.etag },
    });
    expect(updated?.etag).toBeTruthy();
    expect(updated?.etag).not.toBe(created?.etag);
  });
});
