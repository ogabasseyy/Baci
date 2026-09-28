import { describe, expect, it, vi } from 'vitest';
import {
  DOWNLOAD_TIMEOUT_MS,
  MAX_SOURCE_BYTES,
} from './ogabassey-hero-snapshot-config.mjs';
import { fetchSnapshotSource } from './ogabassey-hero-snapshot-source.mjs';

const SOURCE_URL = 'https://cdn.ogabassey.com/core-assets/products/dell.jpg';

function makeFakeFetch({
  body,
  bytes = Buffer.from('fake-source-bytes'),
  contentLength = null,
  contentType = 'image/jpeg',
  status = 200,
  url = undefined,
} = {}) {
  const arrayBuffer = vi.fn(async () => bytes);
  return {
    arrayBuffer,
    fetchImpl: vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      url,
      body,
      headers: {
        get: (name) => {
          const key = String(name).toLowerCase();
          if (key === 'content-type') return contentType;
          if (key === 'content-length') {
            return contentLength === null ? null : String(contentLength);
          }
          return null;
        },
      },
      arrayBuffer,
    })),
  };
}

function streamBody(chunks) {
  let cancelled = false;
  let index = 0;
  return {
    wasCancelled: () => cancelled,
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined },
        cancel: async () => {
          cancelled = true;
        },
      }),
    },
  };
}

function abortError() {
  return Object.assign(new Error('The operation was aborted'), {
    name: 'AbortError',
  });
}

describe('fetchSnapshotSource', () => {
  it('returns bytes for a valid image response', async () => {
    const { fetchImpl } = makeFakeFetch({ url: SOURCE_URL });
    const bytes = await fetchSnapshotSource(SOURCE_URL, fetchImpl);
    expect(Buffer.from(bytes).toString()).toBe('fake-source-bytes');
    expect(fetchImpl).toHaveBeenCalledWith(
      SOURCE_URL,
      expect.objectContaining({ redirect: 'follow', signal: expect.any(AbortSignal) })
    );
  });

  it.each([
    ['not a url', /not a URL/],
    ['http://cdn.ogabassey.com/x.jpg', /non-https/],
  ])('rejects %s', async (url, pattern) => {
    const { fetchImpl } = makeFakeFetch();
    await expect(fetchSnapshotSource(url, fetchImpl)).rejects.toThrow(pattern);
  });

  it('rejects http errors', async () => {
    const { fetchImpl } = makeFakeFetch({ status: 404 });
    await expect(fetchSnapshotSource(SOURCE_URL, fetchImpl)).rejects.toThrow(
      /HTTP 404/
    );
  });

  it('rejects a redirect landing on http', async () => {
    const { fetchImpl } = makeFakeFetch({ url: 'http://evil.example/x.jpg' });
    await expect(fetchSnapshotSource(SOURCE_URL, fetchImpl)).rejects.toThrow(
      /non-https final URL/
    );
  });

  it('rejects non-image content', async () => {
    const { fetchImpl } = makeFakeFetch({ contentType: 'text/html' });
    await expect(fetchSnapshotSource(SOURCE_URL, fetchImpl)).rejects.toThrow(
      /content-type/
    );
  });

  it('converts an aborted fetch into a timeout error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw abortError();
    });
    await expect(fetchSnapshotSource(SOURCE_URL, fetchImpl)).rejects.toThrow(
      new RegExp(`timed out after ${DOWNLOAD_TIMEOUT_MS}ms`)
    );
  });

  it('converts a mid-stream abort into a timeout error', async () => {
    const body = {
      getReader: () => ({
        read: async () => {
          throw abortError();
        },
        cancel: async () => {},
      }),
    };
    const { fetchImpl } = makeFakeFetch({ body });
    await expect(fetchSnapshotSource(SOURCE_URL, fetchImpl)).rejects.toThrow(
      /timed out/
    );
  });

  it('rejects empty and oversized buffered bodies', async () => {
    const empty = makeFakeFetch({ bytes: Buffer.alloc(0) });
    await expect(
      fetchSnapshotSource(SOURCE_URL, empty.fetchImpl)
    ).rejects.toThrow(/0 bytes/);
    const huge = makeFakeFetch({ bytes: Buffer.alloc(MAX_SOURCE_BYTES + 1) });
    await expect(
      fetchSnapshotSource(SOURCE_URL, huge.fetchImpl)
    ).rejects.toThrow(/limit/);
  });

  it('rejects an oversized declared length without reading the body', async () => {
    const { arrayBuffer, fetchImpl } = makeFakeFetch({
      contentLength: MAX_SOURCE_BYTES + 1,
    });
    await expect(fetchSnapshotSource(SOURCE_URL, fetchImpl)).rejects.toThrow(
      /declared/
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('streams small bodies within the cap', async () => {
    const { body } = streamBody([Buffer.from('ab'), Buffer.from('cd')]);
    const { fetchImpl } = makeFakeFetch({ body });
    const bytes = await fetchSnapshotSource(SOURCE_URL, fetchImpl);
    expect(Buffer.from(bytes).toString()).toBe('abcd');
  });

  it('cancels a stream that crosses the cap', async () => {
    const chunk = Buffer.alloc(8 * 1024 * 1024, 1);
    const { body, wasCancelled } = streamBody([chunk, chunk]);
    const { fetchImpl } = makeFakeFetch({ body });
    await expect(fetchSnapshotSource(SOURCE_URL, fetchImpl)).rejects.toThrow(
      /over .* bytes/
    );
    expect(wasCancelled()).toBe(true);
  });
});
