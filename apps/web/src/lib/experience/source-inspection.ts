import type { OwnerRequestContext } from './authorization';
import { requireExperienceOwner } from './authorization';
import { digestBytes } from './manifest-digest';
import { createExperienceRepository } from './repository';

type File = { path: string; content: string };
const metadata = (f: File) => ({
  path: f.path,
  bytes: Buffer.byteLength(f.content),
  digest: digestBytes(f.content),
});
function page<T>(items: T[], cursor: number, limit: number) {
  if (
    !Number.isInteger(cursor) ||
    cursor < 0 ||
    cursor > items.length ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 16
  )
    throw Error('INVALID_REQUEST');
  return {
    files: items.slice(cursor, cursor + limit),
    nextCursor: cursor + limit < items.length ? cursor + limit : null,
  };
}
export function pageSourceMetadata(files: File[], cursor = 0, limit = 16) {
  return page(
    [...files].sort((a, b) => a.path.localeCompare(b.path)).map(metadata),
    cursor,
    limit
  );
}
export function diffSourceFiles(before: File[], after: File[]) {
  const old = new Map(before.map((f) => [f.path, metadata(f)]));
  const next = new Map(after.map((f) => [f.path, metadata(f)]));
  return [...new Set([...old.keys(), ...next.keys()])]
    .sort()
    .flatMap((path) => {
      const a = old.get(path);
      const b = next.get(path);
      return a?.digest === b?.digest
        ? []
        : [
            {
              path,
              change: !a ? 'added' : !b ? 'removed' : 'changed',
              beforeDigest: a?.digest ?? null,
              afterDigest: b?.digest ?? null,
            },
          ];
    });
}
export async function listSourceFiles(
  inputCtx: OwnerRequestContext,
  {
    artifactId,
    cursor = 0,
    limit = 16,
  }: { artifactId: string; cursor?: number; limit?: number }
) {
  const ctx = await requireExperienceOwner(inputCtx);
  const files =
    await createExperienceRepository(ctx).readOwnedSource(artifactId);
  if (!files.length) throw Error('NOT_FOUND');
  return pageSourceMetadata(files, cursor, limit);
}
export async function readSourceDiff(
  inputCtx: OwnerRequestContext,
  input: {
    baseArtifactId: string;
    candidateArtifactId: string;
    cursor?: number;
    limit?: number;
  }
) {
  const ctx = await requireExperienceOwner(inputCtx);
  const repo = createExperienceRepository(ctx);
  const [before, after] = await Promise.all([
    repo.readOwnedSource(input.baseArtifactId),
    repo.readOwnedSource(input.candidateArtifactId),
  ]);
  if (!before.length || !after.length) throw Error('NOT_FOUND');
  return page(
    diffSourceFiles(before, after),
    input.cursor ?? 0,
    input.limit ?? 16
  );
}
