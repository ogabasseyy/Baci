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
  deleteUpload: (request: {
    path: string;
    variantPaths: string[];
    signal: AbortSignal;
  }) => Promise<void>;
  toast: (props: Parameters<ReturnType<typeof useToast>['toast']>[0]) => void;
}) {
  const [pendingInlineUploads, setPendingInlineUploads] = useState(0);
  const settledUploadsRef = useRef<string[]>([]);
  const inflightBatchRef = useRef<{
    controller: AbortController;
    paths: Set<string>;
  } | null>(null);

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
    // them) — except objects the incoming draft itself reuses, which
    // stay tracked for a later import instead of leaking untracked.
    // Unreferenced paths batch into one DELETE call so a long session
    // cannot trip the shared per-minute delete budget.
    const keepPaths = draftReferencedMediaPaths(draft);
    // A new import that reuses a path the in-flight batch is deleting
    // aborts it first: the batch would otherwise remove active-draft
    // media. The aborted uploads stay tracked through the batch's
    // catch, so a later import that drops them deletes them then.
    const inflight = inflightBatchRef.current;
    if (inflight && [...inflight.paths].some((path) => keepPaths.has(path))) {
      inflight.controller.abort();
      inflightBatchRef.current = null;
    }
    const tracked = settledUploadsRef.current;
    if (tracked.length === 0) return;
    const retained: string[] = [];
    const droppedPaths: string[] = [];
    const droppedUrls: string[] = [];
    for (const url of tracked) {
      const path = extractManagedBlogStoragePath(url, { kind: 'platform' });
      if (!path) continue;
      if (keepPaths.has(path)) retained.push(url);
      else {
        droppedPaths.push(path);
        droppedUrls.push(url);
      }
    }
    settledUploadsRef.current = retained;
    if (droppedPaths.length === 0) return;
    const [path, ...variantPaths] = [...new Set(droppedPaths)];
    const controller = new AbortController();
    const batch = {
      controller,
      paths: new Set([path, ...variantPaths]),
    };
    inflightBatchRef.current = batch;
    void (async () => {
      try {
        await deleteUpload({ path, variantPaths, signal: controller.signal });
      } catch (error) {
        // The batch is all-or-nothing: preserve the contributing
        // uploads so the next import retries them instead of
        // leaking the abandoned objects. An abort is intentional —
        // the next import reuses the paths — so it stays silent.
        settledUploadsRef.current.push(...droppedUrls);
        const aborted = error instanceof Error && error.name === 'AbortError';
        if (!aborted) {
          toast({
            title: 'Could not remove replaced upload',
            description:
              error instanceof Error ? error.message : 'Unknown error',
            variant: 'destructive',
          });
        }
      } finally {
        if (inflightBatchRef.current === batch) {
          inflightBatchRef.current = null;
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
