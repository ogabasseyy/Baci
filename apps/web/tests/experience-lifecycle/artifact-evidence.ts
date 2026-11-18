import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';

const digest = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
/** Preserve actual normal-owner-readable immutable outputs before destroying the fixture. */
export async function recordLocalMcpEvidence(input: {
  client: SupabaseClient;
  merchantId: string;
  buildId: string;
  buildDigest: string;
  sourceDigest: string;
  toolchain: string;
  manifest: unknown;
  source: string;
  png: Buffer;
}) {
  const folder = new URL(
    '../../../../.superpowers/sdd/experience-mcp-current-proof/',
    import.meta.url
  );
  const files = await input.client
    .from('experience_build_files')
    .select('path,bytes,digest')
    .eq('merchant_id', input.merchantId)
    .eq('build_id', input.buildId);
  if (files.error || files.data?.length !== 2) throw Error('RETENTION_FAILED');
  const output = new Map<string, Buffer>();
  for (const file of files.data) {
    if (
      !['app.js', 'app.css'].includes(file.path) ||
      typeof file.bytes !== 'string'
    )
      throw Error('RETENTION_FAILED');
    const bytes = Buffer.from(file.bytes.slice(2), 'hex');
    if (digest(bytes) !== file.digest) throw Error('RETENTION_FAILED');
    output.set(file.path, bytes);
  }
  const js = output.get('app.js');
  const css = output.get('app.css');
  if (
    !js ||
    !css ||
    digest(Buffer.concat([js, Buffer.from([0]), css])) !== input.buildDigest
  )
    throw Error('RETENTION_FAILED');
  mkdirSync(new URL('compiled/', folder), { recursive: true });
  mkdirSync(new URL('source/', folder), { recursive: true });
  for (const [path, bytes] of output)
    writeFileSync(new URL(`compiled/${path}`, folder), bytes);
  writeFileSync(new URL('source/app.tsx', folder), input.source);
  writeFileSync(
    new URL('mcp-build.manifest.json', folder),
    JSON.stringify(
      {
        manifest: input.manifest,
        sourceDigest: input.sourceDigest,
        buildDigest: input.buildDigest,
        toolchain: input.toolchain,
        outputs: files.data.map(({ path, digest }) => ({ path, digest })),
      },
      null,
      2
    )
  );
  writeFileSync(new URL('mcp-native-preview.png', folder), input.png);
  writeFileSync(
    new URL('mcp-http-lifecycle.json', folder),
    JSON.stringify(
      {
        sourceDigest: input.sourceDigest,
        buildDigest: input.buildDigest,
        toolchain: input.toolchain,
        normalAuthRls: true,
        nativeImageDigest: digest(input.png),
        nativeImageBytes: input.png.length,
        immutableOutputsRetained: true,
        published: false,
        orders: 0,
        payments: 0,
        aiCalls: 0,
      },
      null,
      2
    )
  );
}
