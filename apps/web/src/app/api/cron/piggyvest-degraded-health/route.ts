import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { runPiggyvestDegradedHealth } from '@/lib/piggyvest/degraded-health-runtime';

export const maxDuration = 30;

// PiggyVest degraded-health check (read-only). Inert until the owner sets
// PIGGYVEST_DEGRADED_ALERTS_ENABLED=true, and not scheduled in vercel.json.
// The response carries counts only.
export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await runPiggyvestDegradedHealth());
  } catch {
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 });
  }
}
