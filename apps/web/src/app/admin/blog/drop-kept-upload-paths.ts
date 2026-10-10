import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';

type UploadResultLike = {
  url: string;
  variants?: Record<string, string>;
};

export function dropKeptUploadPaths<T extends UploadResultLike>(
  result: T,
  keepPaths: Set<string>
): T | null {
  // Complement trim for staged originals: what stays pending when a
  // reuse revives the kept paths back into tracking. Fully reused
  // results vanish from pending instead of being copied.
  const urlPath = extractManagedBlogStoragePath(result.url, {
    kind: 'platform',
  });
  const url = urlPath !== null && !keepPaths.has(urlPath) ? result.url : '';
  const variants = Object.fromEntries(
    Object.entries(result.variants ?? {}).filter(([, variantUrl]) => {
      const variantPath = extractManagedBlogStoragePath(variantUrl, {
        kind: 'platform',
      });
      return variantPath !== null && !keepPaths.has(variantPath);
    })
  );
  if (url === '' && Object.keys(variants).length === 0) return null;
  // The spread preserves caller fields (dimensions); only the trimmed
  // url/variants change shape, so the result still satisfies T.
  return { ...result, url, variants } as T;
}
