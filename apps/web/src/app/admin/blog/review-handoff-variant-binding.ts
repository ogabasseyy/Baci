import {
  getTrustedCdnSourcePath,
  isBlogFeaturedVariantKey,
  isTrustedGeneratedCodexBlogImageUrl,
  isTrustedGeneratedCodexBlogVariantUrl,
} from '@/lib/blog-discover-readiness';
import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';

// The upload route names the source platform/blog/<token>.<ext> and its
// variants platform/blog/<token>/<key>.webp: the token binds a variant
// to the upload that generated it.
function managedUploadToken(storagePath: string): string | null {
  const segments = storagePath.split('/');
  if (segments.length === 4) return segments[2];
  if (segments.length !== 3) return null;
  const dot = segments[2].lastIndexOf('.');
  return dot > 0 ? segments[2].slice(0, dot) : null;
}

function managedVariantBinds(sourceUrl: string, variantUrl: string): boolean {
  const sourcePath = extractManagedBlogStoragePath(sourceUrl, {
    kind: 'platform',
  });
  if (!sourcePath) return true;
  // A managed source binds only managed variants sharing its token: a
  // codex-exempt (non-managed) variant cannot prove it belongs to this
  // upload, and an unparseable source token fails closed.
  const variantPath = extractManagedBlogStoragePath(variantUrl, {
    kind: 'platform',
  });
  if (!variantPath) return false;
  const sourceToken = managedUploadToken(sourcePath);
  return (
    sourceToken !== null && managedUploadToken(variantPath) === sourceToken
  );
}

function generatedCodexVariantBinds(
  variantUrl: string,
  variantKey: string,
  sourceUrl: string
): boolean {
  // True unless the source is a generated-Codex image. A Codex source
  // binds only Codex variants sharing its article directory and image
  // base; anything else (including managed variants from real uploads)
  // belongs to another image and is dropped.
  if (!isTrustedGeneratedCodexBlogImageUrl(sourceUrl)) return true;
  if (
    !isBlogFeaturedVariantKey(variantKey) ||
    !isTrustedGeneratedCodexBlogVariantUrl(variantUrl, variantKey)
  ) {
    return false;
  }
  const sourcePath = getTrustedCdnSourcePath(sourceUrl);
  const variantPath = getTrustedCdnSourcePath(variantUrl);
  if (!sourcePath || !variantPath) return false;
  const sourceDir = sourcePath.slice(0, sourcePath.lastIndexOf('/'));
  const variantDir = variantPath.slice(0, variantPath.lastIndexOf('/'));
  if (sourceDir !== variantDir) return false;
  // Variant filenames carry the key either bare (<key>.<ext>) or
  // slug-suffixed (<slug>-<key>.<ext>); only the latter pins a base,
  // and it must equal the source filename stem.
  const variantFile = variantPath
    .slice(variantPath.lastIndexOf('/') + 1)
    .toLowerCase();
  const keySuffix = `-${variantKey.toLowerCase()}`;
  const dot = variantFile.lastIndexOf('.');
  const stem = dot > 0 ? variantFile.slice(0, dot) : variantFile;
  if (stem === variantKey.toLowerCase()) return true;
  if (!stem.endsWith(keySuffix)) return false;
  const base = stem.slice(0, stem.length - keySuffix.length);
  const sourceFile = sourcePath
    .slice(sourcePath.lastIndexOf('/') + 1)
    .toLowerCase();
  const sourceDot = sourceFile.lastIndexOf('.');
  const sourceStem =
    sourceDot > 0 ? sourceFile.slice(0, sourceDot) : sourceFile;
  return base !== '' && base === sourceStem;
}

/**
 * Whether a handoff variant belongs with the featured-image source. A
 * managed source binds only same-token managed variants; a generated
 * source binds only same-article Codex variants; a foreign source has
 * no identity to bind to, so its variants keep existing handling.
 */
export function variantBindsToSource(
  variantUrl: string,
  variantKey: string,
  sourceUrl: string
): boolean {
  return (
    managedVariantBinds(sourceUrl, variantUrl) &&
    generatedCodexVariantBinds(variantUrl, variantKey, sourceUrl)
  );
}
