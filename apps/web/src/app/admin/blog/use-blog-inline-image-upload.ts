import { useRef, useState } from 'react';
import type { useToast } from '@/hooks/use-toast';
import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';
import type { PlatformAdminBlogFormState } from './blog-types';
import { draftReferencedMediaPaths } from './draft-referenced-media-paths';

/**
 * Track pending inline-image uploads so imports wait until they settle:
 * importing remounts the editor, which would abandon the upload's
 * completion callback and strand the persisted file. Settled session
 * uploads are tracked too, so an accepted import can delete the ones
 * its draft does not reference instead of leaking them.
 */
export function useBlogInlineImageUpload({
  upload,
  deleteUpload,
  toast,
}: {
  upload: (file: File) => Promise<{ url: string }>;
  deleteUpload: (paths: {
    path: string;
    variantPaths: string[];
  }) => Promise<void>;
  toast: (props: Parameters<ReturnType<typeof useToast>['toast']>[0]) => void;
}) {
  const [pendingInlineUploads, setPendingInlineUploads] = useState(0);
  const settledUploadsRef = useRef<string[]>([]);

  const uploadInlineImage = (file: File) => {
    setPendingInlineUploads((count) => count + 1);
    return upload(file)
      .finally(() => {
        setPendingInlineUploads((count) => count - 1);
      })
      .then((result) => {
        settledUploadsRef.current.push(result.url);
        return result.url;
      });
  };

  const cleanupSettledInlineUploads = (
    draft: Pick<
      PlatformAdminBlogFormState,
      'content' | 'featured_image_url' | 'featured_image_variants'
    >
  ) => {
    // Every tracked inline result is unreferenced once the import
    // discards the old body (saves navigate away, so nothing persisted
    // them) — except objects the incoming draft itself reuses.
    const tracked = settledUploadsRef.current;
    settledUploadsRef.current = [];
    if (tracked.length === 0) return;
    const keepPaths = draftReferencedMediaPaths(draft);
    void (async () => {
      for (const url of tracked) {
        const path = extractManagedBlogStoragePath(url, { kind: 'platform' });
        if (!path || keepPaths.has(path)) continue;
        try {
          await deleteUpload({ path, variantPaths: [] });
        } catch (error) {
          toast({
            title: 'Could not remove replaced upload',
            description:
              error instanceof Error ? error.message : 'Unknown error',
            variant: 'destructive',
          });
        }
      }
    })();
  };

  return {
    cleanupSettledInlineUploads,
    inlineUploadsPending: pendingInlineUploads > 0,
    uploadInlineImage,
  };
}
