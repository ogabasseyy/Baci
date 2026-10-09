import { NextResponse } from 'next/server';
import type { createClient } from '@/lib/supabase/server';
import { tombstoneBlogMediaPaths } from './blog-media-tombstone-write';
import { cleanupUploadedPaths } from './upload-helpers';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Stage freshly uploaded objects as tombstones and return null, or
 * remove them and return the 500 response when staging fails. The
 * unmount flush never runs when the tab closes mid-draft, so the
 * upload itself must leave the record the sweep reaps after the
 * grace window; a successful save clears the staged rows through
 * clearBlogMediaTombstonesForRow. Failing the upload on a staging
 * error leaves no unstaged orphan for the client to retry around.
 */
export async function stageUploadedBlogMediaPaths(
  supabase: ServerSupabaseClient,
  uploadedPaths: string[]
): Promise<NextResponse | null> {
  const staged = await tombstoneBlogMediaPaths(supabase, uploadedPaths);
  if (staged) return null;
  await cleanupUploadedPaths(supabase, uploadedPaths);
  console.error('Platform blog media upload staging failed', {
    uploadedPaths,
  });
  return NextResponse.json(
    { error: 'Failed to upload file', code: 'UPLOAD_FAILED' },
    { status: 500 }
  );
}
