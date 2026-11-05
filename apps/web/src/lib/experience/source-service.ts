import { parseExperienceManifest } from '@/schemas/experience-manifest';
import { experienceSourcePatch } from '@/schemas/experience-source-patch';
import { experienceSourcePath } from '@/schemas/experience-upload';
import {
  type OwnerRequestContext,
  ownerRpcArgs,
  requireExperienceOwner,
} from './authorization';
import { canonicalManifest, digestBytes } from './manifest-digest';
import {
  beginUpload,
  finalizeUpload,
  sourcePage,
  writeChunk,
} from './upload-service';

export async function readSource(
  inputCtx: OwnerRequestContext,
  input: {
    artifactId: string;
    path: string;
    byteOffset: number;
    maxBytes: number;
  }
) {
  const ctx = await requireExperienceOwner(inputCtx);
  experienceSourcePath.parse(input.path);
  const r = await ctx.supabase
    .from('experience_source_files')
    .select('content')
    .eq('merchant_id', ctx.merchantId)
    .eq('artifact_id', input.artifactId)
    .eq('path', input.path)
    .maybeSingle();
  if (r.error || !r.data) throw Error('NOT_FOUND');
  return sourcePage(r.data.content, input.byteOffset, input.maxBytes);
}
export async function patchSource(
  inputCtx: OwnerRequestContext,
  input: unknown
) {
  const v = experienceSourcePatch.parse(input);
  const ctx = await requireExperienceOwner(inputCtx);
  const base = await ctx.supabase
    .from('experience_artifacts')
    .select('manifest')
    .eq('merchant_id', ctx.merchantId)
    .eq('source_digest', v.baseDigest)
    .maybeSingle();
  if (base.error || !base.data) throw Error('NOT_FOUND');
  const previous = parseExperienceManifest(base.data.manifest);
  const changed = new Map(v.files.map((f) => [f.path, f.content]));
  const files = previous.files.map((f) => ({
    path: f.path,
    content: changed.get(f.path) ?? f.content,
  }));
  for (const f of v.files)
    if (!files.some((p) => p.path === f.path)) files.push(f);
  const manifest = parseExperienceManifest({ ...previous, files });
  const upload = await beginUpload(ctx, {
    manifest: { ...manifest, files: files.map((f) => ({ ...f, content: '' })) },
    files: {
      files: files.map((f) => ({
        path: f.path,
        bytes: Buffer.byteLength(f.content),
        digest: digestBytes(f.content),
      })),
    },
  });
  for (const f of files) {
    const bytes = Buffer.from(f.content);
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      const chunk = bytes.subarray(offset, offset + 32768);
      await writeChunk(ctx, {
        uploadId: upload.uploadId,
        path: f.path,
        offset,
        bytes: chunk,
        chunkDigest: digestBytes(chunk),
      });
    }
  }
  const candidate = await finalizeUpload(ctx, upload);
  const result = await ctx.supabase.rpc('experience_apply_source', {
    ...ownerRpcArgs(ctx),
    p_artifact: candidate.artifactId,
    p_base: v.baseDigest,
    p_expected: v.expectedVersion,
    p_retry: v.idempotencyKey,
    p_payload: digestBytes(canonicalManifest(manifest)),
  });
  if (result.error) throw Error('IDEMPOTENCY_CONFLICT');
  return result.data as {
    artifactId: string;
    version: number;
    conflict: boolean;
  };
}
