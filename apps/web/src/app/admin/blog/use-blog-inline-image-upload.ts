import { type RefObject, useEffect, useRef, useState } from 'react';
import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';
import type { PlatformAdminBlogFormState } from './blog-types';
import { chunkArray } from './chunk-array';
import { draftReferencedMediaPaths } from './draft-referenced-media-paths';
import { useBlogMediaTombstoneHeartbeat } from './use-blog-media-tombstone-heartbeat';

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
  refreshUpload,
  savedFormRef,
  heartbeatIntervalMs,
}: {
  upload: (file: File) => Promise<{ url: string }>;
  deleteUpload: (paths: {
    path: string;
    variantPaths: string[];
  }) => Promise<void>;
  refreshUpload: (paths: string[]) => Promise<void>;
  savedFormRef: RefObject<PlatformAdminBlogFormState | null>;
  heartbeatIntervalMs?: number;
}) {
  const [pendingInlineUploads, setPendingInlineUploads] = useState(0);
  const settledUploadsRef = useRef<string[]>([]);
  const pendingDeletesRef = useRef<string[]>([]);
  const mountedRef = useRef(true);
  const deleteUploadRef = useRef(deleteUpload);
  deleteUploadRef.current = deleteUpload;

  const deleteLateUpload = async (url: string) => {
    // A result arriving after teardown was never inserted anywhere, so
    // the persisted object is deleted instead of tracked into a dead
    // ref. A non-managed URL is never ours to delete.
    const path = extractManagedBlogStoragePath(url, { kind: 'platform' });
    if (!path) return;
    try {
      await deleteUploadRef.current({ path, variantPaths: [] });
    } catch {
      // Intentionally silent: no session is left to retry in.
    }
  };

  // Deferred dispatch, mirroring the featured hook: cleanups stage
  // uploads and a reuse revives them before anything is dispatched,
  // since an aborted fetch cannot recall a DELETE the server
  // already ran. The flush covers settled and staged uploads alike
  // (an upload discarded without any import never stages), minus
  // the last saved payload; a failed flush leaks silently — there
  // is no session left to retry in.
  useEffect(() => {
    mountedRef.current = true; // StrictMode replays setup after cleanup.
    return () => {
      mountedRef.current = false;
      // Teardown leaves the page, so only the last server-confirmed
      // payload earns retention: live-form references are unpersisted
      // by definition here, and keeping them would orphan
      // upload-then-Back media.
      const keepPaths = new Set<string>();
      const saved = savedFormRef.current;
      if (saved !== null) {
        for (const path of draftReferencedMediaPaths(saved)) {
          keepPaths.add(path);
        }
      }
      const paths = new Set<string>();
      const candidates = [
        ...settledUploadsRef.current,
        ...pendingDeletesRef.current,
      ];
      for (const url of candidates) {
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
    };
  }, [savedFormRef]);

  // Mirror the featured hook: settled session uploads stage at
  // POST time, so each beat extends the ones the last saved payload
  // does not keep. Staged uploads stay out to expire.
  useBlogMediaTombstoneHeartbeat({
    getPaths: () => {
      const keepPaths = new Set<string>();
      const saved = savedFormRef.current;
      if (saved !== null) {
        for (const path of draftReferencedMediaPaths(saved)) {
          keepPaths.add(path);
        }
      }
      const paths = new Set<string>();
      for (const url of settledUploadsRef.current) {
        const path = extractManagedBlogStoragePath(url, { kind: 'platform' });
        if (path !== null && !keepPaths.has(path)) paths.add(path);
      }
      return [...paths];
    },
    intervalMs: heartbeatIntervalMs,
    refresh: refreshUpload,
  });

  const uploadInlineImage = (file: File) => {
    setPendingInlineUploads((count) => count + 1);
    return upload(file)
      .finally(() => {
        setPendingInlineUploads((count) => count - 1);
      })
      .then((result) => {
        if (!mountedRef.current) void deleteLateUpload(result.url);
        else settledUploadsRef.current.push(result.url);
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
    // A reuse moves staged uploads back into tracking: copying
    // would double the tracked entries on every retain/discard
    // cycle. Inline uploads are atomic, so a revived URL leaves
    // pending entirely.
    const tracked = settledUploadsRef.current;
    const stillPending: string[] = [];
    for (const url of pendingDeletesRef.current) {
      const path = extractManagedBlogStoragePath(url, { kind: 'platform' });
      if (path !== null && keepPaths.has(path)) tracked.push(url);
      else stillPending.push(url);
    }
    pendingDeletesRef.current = stillPending;
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
