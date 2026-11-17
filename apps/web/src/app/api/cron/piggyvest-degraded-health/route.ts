import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { runPiggyvestDegradedHealth } from '@/lib/piggyvest/degraded-health-runtime';

export const maxDuration = 30;

// PiggyVest degraded-health check (read-only). Inert until the owner sets
// PIGGYVEST_DEGRADED_ALERTS_ENABLED=true; the VPS worker crontab calls it every 5 minutes.
// The response carries counts only.
export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await runPiggyvestDegradedHealth());
  } catch (error) {
    // Unexpected (read problems already come back as readFailed). Log the
    // error name only: no payloads, ids or secrets.
    console.error(
      `[PiggyVest Degraded][ERROR] health check failed ${error instanceof Error ? error.name : 'unknown'}`
    );
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 });
  }
}
