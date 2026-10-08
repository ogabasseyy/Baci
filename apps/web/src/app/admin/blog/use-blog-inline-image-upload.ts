import { type RefObject, useEffect, useRef, useState } from 'react';
import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';
import type { PlatformAdminBlogFormState } from './blog-types';
import { chunkArray } from './chunk-array';
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
  formRef,
  savedFormRef,
}: {
  upload: (file: File) => Promise<{ url: string }>;
  deleteUpload: (paths: {
    path: string;
    variantPaths: string[];
  }) => Promise<void>;
  formRef: RefObject<PlatformAdminBlogFormState>;
  savedFormRef: RefObject<PlatformAdminBlogFormState | null>;
}) {
  const [pendingInlineUploads, setPendingInlineUploads] = useState(0);
  const settledUploadsRef = useRef<string[]>([]);
  const pendingDeletesRef = useRef<string[]>([]);
  const deleteUploadRef = useRef(deleteUpload);
  deleteUploadRef.current = deleteUpload;

  // Deferred dispatch, mirroring the featured hook: cleanups stage
  // uploads and a reuse revives them before anything is dispatched,
  // since an aborted fetch cannot recall a DELETE the server
  // already ran. The staged uploads flush once on unmount, minus
  // the live form and the last saved payload; a failed flush leaks
  // silently — there is no session left to retry in.
  useEffect(
    () => () => {
      const keepPaths = draftReferencedMediaPaths(formRef.current);
      const saved = savedFormRef.current;
      if (saved !== null) {
        for (const path of draftReferencedMediaPaths(saved)) {
          keepPaths.add(path);
        }
      }
      const paths = new Set<string>();
      for (const url of pendingDeletesRef.current) {
        const path = extractManagedBlogStoragePath(url, { kind: 'platform' });
        if (path !== null && !keepPaths.has(path)) paths.add(path);
      }
      // Supabase remove() caps at 1,000 objects per call: chunk the
      // flush and send sequentially so one oversized session cannot
      // fail the whole batch (or burst the shared rate limit).
      const send = async () => {
        for (const chunk of chunkArray([...paths], 1000)) {
          const [path, ...variantPaths] = chunk;
          try {
            await deleteUploadRef.current({ path, variantPaths });
          } catch {
            // Intentionally silent: no session is left to retry in.
          }
        }
      };
      void send();
    },
    [formRef, savedFormRef]
  );

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
    // A reuse revives staged uploads back into tracking; staged
    // originals stay put, since the flush filters by live keeps
    // and never double-deletes.
    const tracked = settledUploadsRef.current;
    for (const url of pendingDeletesRef.current) {
      const path = extractManagedBlogStoragePath(url, { kind: 'platform' });
      if (path !== null && keepPaths.has(path)) tracked.push(url);
    }
    if (tracked.length === 0) return;
    const retained: string[] = [];
    for (const url of tracked) {
      const path = extractManagedBlogStoragePath(url, { kind: 'platform' });
      if (!path) continue;
      if (keepPaths.has(path)) retained.push(url);
      else pendingDeletesRef.current.push(url);
    }
    settledUploadsRef.current = retained;
  };

  return {
    cleanupSettledInlineUploads,
    inlineUploadsPending: pendingInlineUploads > 0,
    uploadInlineImage,
  };
}
