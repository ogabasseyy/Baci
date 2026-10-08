import { type NextRequest, NextResponse } from 'next/server';
import { sweepDueBlogMediaTombstones } from '@/app/api/admin/blog/upload/blog-media-tombstone-sweep';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { createServiceClient } from '@/lib/supabase/service';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sweepDueBlogMediaTombstones(createServiceClient());
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
