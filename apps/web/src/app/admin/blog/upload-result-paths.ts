import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';

type UploadResultLike = {
  url: string;
  variants?: Record<string, string>;
};

/**
 * Storage paths carried by an upload result. Revived results refresh
 * these tombstones immediately on promotion: their lease may already
 * be due, and waiting for the next heartbeat leaves a gap the sweep
 * can claim through.
 */
export function uploadResultPaths(result: UploadResultLike): string[] {
  return [result.url, ...Object.values(result.variants ?? {})]
    .map((url) => extractManagedBlogStoragePath(url, { kind: 'platform' }))
    .filter((path): path is string => path !== null);
}
