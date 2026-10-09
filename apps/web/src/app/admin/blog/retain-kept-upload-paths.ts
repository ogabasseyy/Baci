import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';

type UploadResultLike = {
  url: string;
  variants?: Record<string, string>;
};

export function retainKeptUploadPaths<T extends UploadResultLike>(
  result: T,
  keepPaths: Set<string>
): T | null {
  // A result the draft partially reuses stays tracked trimmed to its
  // kept paths, so a later import deletes only what is still
  // abandoned instead of retrying already-deleted objects.
  const urlPath = extractManagedBlogStoragePath(result.url, {
    kind: 'platform',
  });
  const url = urlPath !== null && keepPaths.has(urlPath) ? result.url : '';
  const variants = Object.fromEntries(
    Object.entries(result.variants ?? {}).filter(([, variantUrl]) => {
      const variantPath = extractManagedBlogStoragePath(variantUrl, {
        kind: 'platform',
      });
      return variantPath !== null && keepPaths.has(variantPath);
    })
  );
  if (url === '' && Object.keys(variants).length === 0) return null;
  // The spread preserves caller fields (dimensions); only the trimmed
  // url/variants change shape, so the result still satisfies T.
  return { ...result, url, variants } as T;
}
