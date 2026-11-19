import type { ExperienceManifest } from '@baci/shared/experience';
import { parseExperienceManifest } from '@/schemas/experience-manifest';
import {
  experienceChunkSchema,
  uploadDescriptorSchema,
} from '@/schemas/experience-upload';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
import { canonicalManifest, digestBytes } from './manifest-digest';
export const validateUploadDescriptor = (v: unknown) =>
  uploadDescriptorSchema.parse(v);
export function assembleSource(
  chunks: Array<{ offset: number; bytes: Uint8Array; digest: string }>,
  file: { bytes: number; digest: string }
): string {
  let at = 0;
  const ordered = [...chunks].sort((a, b) => a.offset - b.offset);
  for (const c of ordered) {
    if (
      c.offset !== at ||
      c.bytes.length > 32768 ||
      digestBytes(c.bytes) !== c.digest
    )
      throw Error('INVALID_REQUEST');
    at += c.bytes.length;
  }
  if (at !== file.bytes) throw Error('INVALID_REQUEST');
  const bytes = Buffer.concat(ordered.map((c) => Buffer.from(c.bytes)));
  if (digestBytes(bytes) !== file.digest) throw Error('INVALID_REQUEST');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes
    );
  } catch {
    throw Error('INVALID_REQUEST');
  }
}
export function sourcePage(
  content: string,
  byteOffset: number,
  maxBytes: number
) {
  const b = Buffer.from(content);
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    byteOffset > b.length ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 32768 ||
    (byteOffset < b.length && (b[byteOffset] & 192) === 128)
  )
    throw Error('INVALID_REQUEST');
  let end = Math.min(b.length, byteOffset + maxBytes);
  while (end > byteOffset && end < b.length && (b[end] & 192) === 128) end--;
  const make = (end: number) => ({
    content: b.subarray(byteOffset, end).toString('utf8'),
    byteOffset,
    nextCursor: end < b.length ? end : null,
  });
  let low = byteOffset;
  let high = end;
  let best = byteOffset;
  while (low <= high) {
    let mid = Math.floor((low + high) / 2);
    while (mid > byteOffset && mid < b.length && (b[mid] & 192) === 128) mid--;
    if (mid <= best) {
      low = Math.max(low + 1, Math.floor((low + high) / 2) + 1);
      continue;
    }
    if (
      Buffer.byteLength(JSON.stringify({ status: 'ok', value: make(mid) })) <=
      98304
    ) {
      best = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  if (best > byteOffset || byteOffset === b.length) return make(best);

  throw Error('INVALID_REQUEST');
}
export async function beginUpload(
  inputCtx: OwnerRequestContext,
  input: { manifest: ExperienceManifest; files: unknown }
) {
  const ctx = await requireExperienceOwner(inputCtx);
  const manifest = parseExperienceManifest(input.manifest);
  const descriptor = validateUploadDescriptor(input.files);
  if (
    manifest.files.some((f) => f.content !== '') ||
    JSON.stringify(manifest.files.map((f) => f.path).sort()) !==
      JSON.stringify(descriptor.files.map((f) => f.path).sort())
  )
    throw Error('INVALID_REQUEST');
  const { data, error } = await ctx.supabase.rpc('experience_begin_upload', {
    ...ownerRpcArgs(ctx),
    p_manifest: { manifest, files: descriptor.files },
  });
  if (error || typeof data !== 'string') throw Error('INVALID_REQUEST');
  return { uploadId: data };
}
export async function writeChunk(
  inputCtx: OwnerRequestContext,
  input: unknown
) {
  const ctx = await requireExperienceOwner(inputCtx);
  const v = experienceChunkSchema.parse(input);
  if (digestBytes(v.bytes) !== v.chunkDigest) throw Error('INVALID_REQUEST');
  const { data, error } = await ctx.supabase.rpc('experience_write_chunk', {
    ...ownerRpcArgs(ctx),
    p_upload: v.uploadId,
    p_path: v.path,
    p_offset: v.offset,
    p_bytes: Buffer.from(v.bytes).toString('hex'),
    p_digest: v.chunkDigest,
  });
  if (error) throw Error('INVALID_REQUEST');
  return { received: data };
}
export async function finalizeUpload(
  inputCtx: OwnerRequestContext,
  { uploadId }: { uploadId: string }
) {
  const ctx = await requireExperienceOwner(inputCtx);
  const u = await ctx.supabase
    .from('experience_uploads')
    .select('manifest,expires_at,finalized_artifact_id')
    .eq('merchant_id', ctx.merchantId)
    .eq('id', uploadId)
    .maybeSingle();
  if (u.error || !u.data || Date.parse(u.data.expires_at) <= Date.now())
    throw Error('NOT_FOUND');
  if (u.data.finalized_artifact_id) {
    const existing = await ctx.supabase
      .from('experience_artifacts')
      .select('source_digest')
      .eq('merchant_id', ctx.merchantId)
      .eq('id', u.data.finalized_artifact_id)
      .maybeSingle();
    if (existing.error || !existing.data) throw Error('NOT_FOUND');
    return {
      artifactId: u.data.finalized_artifact_id as string,
      sourceDigest: existing.data.source_digest as string,
    };
  }
  const desc = validateUploadDescriptor({ files: u.data.manifest.files });
  const template = parseExperienceManifest(u.data.manifest.manifest);
  const files = [];
  for (const f of desc.files) {
    const chunks: Array<{ offset: number; bytes: Uint8Array; digest: string }> =
      [];
    let after = -1;
    let received = 0;
    for (;;) {
      const page = await ctx.supabase
        .from('experience_chunks')
        .select('byte_offset,bytes,digest')
        .eq('merchant_id', ctx.merchantId)
        .eq('upload_id', uploadId)
        .eq('path', f.path)
        .gt('byte_offset', after)
        .order('byte_offset')
        .limit(128);
      if (page.error || !page.data) throw Error('NOT_FOUND');
      if (!page.data.length) break;
      for (const chunk of page.data) {
        const bytes = Buffer.from(chunk.bytes.slice(2), 'hex');
        received += bytes.length;
        if (chunk.byte_offset <= after || !bytes.length || received > f.bytes)
          throw Error('INVALID_REQUEST');
        chunks.push({ offset: chunk.byte_offset, bytes, digest: chunk.digest });
        after = chunk.byte_offset;
      }
    }
    files.push({
      path: f.path,
      content: assembleSource(chunks, f),
    });
  }
  const manifest = parseExperienceManifest({ ...template, files });
  const canonical = canonicalManifest(manifest);
  const result = await ctx.supabase.rpc('experience_finalize_upload', {
    ...ownerRpcArgs(ctx),
    p_upload: uploadId,
    p_canonical: canonical,
    p_digest: digestBytes(canonical),
  });
  if (result.error || typeof result.data !== 'string')
    throw Error('INVALID_REQUEST');
  return { artifactId: result.data, sourceDigest: digestBytes(canonical) };
}
