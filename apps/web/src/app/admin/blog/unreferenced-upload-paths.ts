import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';

type UploadResultLike = {
  url: string;
  variants?: Record<string, string>;
};

export function unreferencedUploadPaths(
  result: UploadResultLike,
  keepPaths: Set<string>
): string[] {
  return [result.url, ...Object.values(result.variants ?? {})]
    .map((url) => extractManagedBlogStoragePath(url, { kind: 'platform' }))
    .filter((path): path is string => path !== null && !keepPaths.has(path));
}
