import { describe, expect, it } from 'vitest';
import { MAX_SERVED_PAGE_BYTES } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { readBoundedPageText } from './merchant-image-pilot-preflight-served.mjs';

describe('readBoundedPageText', () => {
  it('streams a small page body to text', async () => {
    const html =
      '<!doctype html><html><body data-pilot-lab-arm="pilot"></body></html>';
    await expect(
      readBoundedPageText(new Response(html), 'http://origin/pilot-lab')
    ).resolves.toBe(html);
  });

  it('rejects a body past the served-page ceiling without buffering it', async () => {
    // A corrupted or compromised origin answering with tens of megabytes
    // must fail the gate, not exhaust the preflight process: the reader
    // trips mid-stream instead of buffering the whole body first.
    let chunks = 0;
    const stream = new ReadableStream({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    await expect(
      readBoundedPageText(
        new Response(stream),
        'http://origin/pilot-lab?arm=pilot'
      )
    ).rejects.toThrow(/served-page ceiling/);
    expect(chunks).toBeLessThanOrEqual(
      MAX_SERVED_PAGE_BYTES / (1024 * 1024) + 1
    );
  });

  it('accepts a body exactly at the ceiling', async () => {
    const body = 'x'.repeat(MAX_SERVED_PAGE_BYTES);
    await expect(
      readBoundedPageText(new Response(body), 'http://origin/pilot-lab')
    ).resolves.toBe(body);
  });

  it('bounds non-streaming responses after the fact', async () => {
    const small = { text: async () => '<html></html>' };
    await expect(
      readBoundedPageText(small, 'http://origin/pilot-lab')
    ).resolves.toBe('<html></html>');
    const huge = { text: async () => 'x'.repeat(MAX_SERVED_PAGE_BYTES + 1) };
    await expect(
      readBoundedPageText(huge, 'http://origin/pilot-lab')
    ).rejects.toThrow(/served-page ceiling/);
  });
});
