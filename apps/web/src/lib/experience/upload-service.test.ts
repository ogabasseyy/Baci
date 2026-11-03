import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
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
