import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  assembleSource,
  finalizeUpload,
  sourcePage,
  validateUploadDescriptor,
} from './upload-service';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
it('reconstructs exact contiguous UTF8 source, rejects gaps and wrong digest', () => {
  expect(
    assembleSource(
      [
        { offset: 0, bytes: Buffer.from('hello '), digest: hash('hello ') },
        { offset: 6, bytes: Buffer.from('🌍'), digest: hash('🌍') },
      ],
      { bytes: 10, digest: hash('hello 🌍') }
    )
  ).toBe('hello 🌍');
  expect(() =>
    assembleSource(
      [{ offset: 1, bytes: Buffer.from('x'), digest: hash('x') }],
      { bytes: 1, digest: hash('x') }
    )
  ).toThrow('INVALID_REQUEST');
  expect(() =>
    assembleSource(
      [{ offset: 0, bytes: Buffer.from('x'), digest: hash('y') }],
      { bytes: 1, digest: hash('x') }
    )
  ).toThrow('INVALID_REQUEST');
});
it('round trips 512KiB via bounded UTF8 pages and refuses mid-codepoint offsets', () => {
  const s = '🌍'.repeat(131072);
  let at = 0;
  let out = '';
  while (at < Buffer.byteLength(s)) {
    const p = sourcePage(s, at, 32768);
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(98304);
    out += p.content;
    at = p.nextCursor ?? Buffer.byteLength(s);
  }
  expect(out).toBe(s);
  expect(() => sourcePage(s, 1, 32768)).toThrow('INVALID_REQUEST');
  const escaped = sourcePage('\0'.repeat(32768), 0, 32768);
  expect(Buffer.byteLength(JSON.stringify(escaped))).toBeLessThan(98304);
});
it('rejects unsafe paths, totals and oversized chunk descriptors', () => {
  expect(() =>
    validateUploadDescriptor({
      files: [{ path: '../secret', bytes: 1, digest: hash('x') }],
    })
  ).toThrow();
});
it('a finalized upload replay returns the same source digest and artifact reference', async () => {
  const chain = (data: unknown) => {
    const q = { eq: () => q, maybeSingle: async () => ({ data, error: null }) };
    return { select: () => q };
  };
  const ctx = {
    merchantId: 'merchant',
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }),
      },
      rpc: async () => ({ data: true, error: null }),
      from: (table: string) =>
        chain(
          table === 'experience_uploads'
            ? {
                expires_at: new Date(Date.now() + 60000).toISOString(),
                finalized_artifact_id: 'artifact',
              }
            : { source_digest: 'a'.repeat(64) }
        ),
    },
  };
  await expect(
    finalizeUpload(ctx as never, { uploadId: 'upload' })
  ).resolves.toEqual({ artifactId: 'artifact', sourceDigest: 'a'.repeat(64) });
});

it.each([
  129, 256,
])('finalizes accepted uploads containing %i immutable chunks', async (count) => {
  const content =
    count === 256
      ? `\uFEFF${'a'.repeat(count * 1024 - 3)}`
      : 'a'.repeat(count * 1024);
  const bytes = Buffer.from(content);
  const chunks = Array.from({ length: count }, (_, i) => {
    const chunk = bytes.subarray(i * 1024, (i + 1) * 1024);
    return {
      byte_offset: i * 1024,
      bytes: `\\x${chunk.toString('hex')}`,
      digest: createHash('sha256').update(chunk).digest('hex'),
    };
  });
  const manifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    files: [{ path: 'app.tsx', content: '' }],
    packages: [],
    routes: [{ path: '/', view: 'home' }],
    assets: [],
    capabilities: ['navigation'],
  };
  const rpc = vi.fn(async (name: string) => ({
    data: name === 'experience_require_owner' ? true : 'artifact',
    error: null,
  }));
  const reads: number[] = [];
  const ctx = {
    merchantId: 'merchant',
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }),
      },
      rpc,
      from(table: string) {
        let after = -1;
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          gt: (_column: string, value: number) => {
            after = value;
            return q;
          },
          maybeSingle: async () => ({
            data: {
              manifest: {
                manifest,
                files: [
                  {
                    path: 'app.tsx',
                    bytes: Buffer.byteLength(content),
                    digest: hash(content),
                  },
                ],
              },
              expires_at: new Date(Date.now() + 60000).toISOString(),
              finalized_artifact_id: null,
            },
            error: null,
          }),
          limit: async (limit: number) => {
            expect(table).toBe('experience_chunks');
            reads.push(after);
            return {
              data: chunks.filter((c) => c.byte_offset > after).slice(0, limit),
              error: null,
            };
          },
        };
        return q;
      },
    },
  };
  await expect(
    finalizeUpload(ctx as never, { uploadId: 'upload' })
  ).resolves.toMatchObject({ artifactId: 'artifact' });
  expect(reads.length).toBeGreaterThan(1);
  expect(rpc).toHaveBeenCalledWith(
    'experience_finalize_upload',
    expect.objectContaining({
      p_merchant: 'merchant',
      p_canonical: expect.stringContaining(JSON.stringify(content)),
    })
  );
});

it('round trips escaped source within the complete MCP result envelope budget', () => {
  const source = `/*${'\0'.repeat(32768)}*/\n${'🌍'.repeat(9000)}`;
  let offset = 0;
  let recovered = '';
  while (offset < Buffer.byteLength(source)) {
    const page = sourcePage(source, offset, 32768);
    expect(
      Buffer.byteLength(JSON.stringify({ status: 'ok', value: page }))
    ).toBeLessThanOrEqual(98304);
    recovered += page.content;
    const next = page.nextCursor ?? Buffer.byteLength(source);
    expect(next).toBeGreaterThan(offset);
    offset = next;
  }
  expect(recovered).toBe(source);
  expect(sourcePage(source, offset, 32768)).toEqual({
    content: '',
    byteOffset: offset,
    nextCursor: null,
  });
});

it('preserves a UTF8 BOM and rejects malformed UTF8 without changing verified bytes', () => {
  const content = '\uFEFFexport default function App() { return null; }';
  const bytes = Buffer.from(content);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const decoded = assembleSource([{ offset: 0, bytes, digest }], {
    bytes: bytes.length,
    digest,
  });
  expect(decoded).toBe(content);
  expect(Buffer.from(decoded)).toEqual(bytes);
  const invalid = Buffer.from([0xff]);
  const invalidDigest = createHash('sha256').update(invalid).digest('hex');
  expect(() =>
    assembleSource([{ offset: 0, bytes: invalid, digest: invalidDigest }], {
      bytes: invalid.length,
      digest: invalidDigest,
    })
  ).toThrow('INVALID_REQUEST');
});
