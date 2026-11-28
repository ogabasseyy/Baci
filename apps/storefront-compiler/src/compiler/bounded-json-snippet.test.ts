import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildBoundedCatalogJsonSnippet } from './bounded-json-snippet';

function createBoundedReader() {
  const ctx: Record<string, unknown> = {
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Number,
    JSON,
  };
  vm.runInNewContext(
    `${buildBoundedCatalogJsonSnippet()}\nglobalThis.read = readBoundedCatalogJson;`,
    ctx
  );
  return ctx.read as (res: Response, maxBytes: number) => Promise<unknown>;
}

describe('bounded-json-snippet', () => {
  it('parses bounded JSON responses and returns null when Content-Length or streamed bytes exceed maxBytes', async () => {
    const read = createBoundedReader();
    await expect(
      read(new Response(JSON.stringify({ ok: true })), 1024)
    ).resolves.toEqual({ ok: true });

    await expect(
      read(
        new Response('{"big":"payload"}', {
          headers: { 'content-length': '999999' },
        }),
        64
      )
    ).resolves.toBeNull();

    await expect(
      read(new Response(JSON.stringify({ data: 'x'.repeat(200) })), 32)
    ).resolves.toBeNull();
  });
});
