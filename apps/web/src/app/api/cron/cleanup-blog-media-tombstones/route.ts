import { type NextRequest, NextResponse } from 'next/server';
import { sweepDueBlogMediaTombstones } from '@/app/api/admin/blog/upload/blog-media-tombstone-sweep';
import { createBlogMediaSweepWorkerClient } from '@/lib/blog-media-sweep-worker-client';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Least-privilege worker capability: the sweep's wrapper RPCs plus
    // media-bucket removal only. Construction throws until the worker
    // token is provisioned, failing closed to a retried 500.
    const result = await sweepDueBlogMediaTombstones(
      createBlogMediaSweepWorkerClient(process.env)
    );
    if (result === null) {
      return NextResponse.json(
        { error: 'Tombstone sweep failed' },
        { status: 500 }
      );
    }
    return NextResponse.json(result);
  } catch {
    console.error('Blog media tombstone sweep failed');
    return NextResponse.json(
      { error: 'Tombstone sweep failed' },
      { status: 500 }
    );
  }
}
