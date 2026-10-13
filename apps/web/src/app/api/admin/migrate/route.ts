import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';

function authError(status: 'forbidden' | 'unauthenticated') {
  return NextResponse.json(
    { error: status === 'unauthenticated' ? 'Unauthorized' : 'Forbidden' },
    { status: status === 'unauthenticated' ? 401 : 403 }
  );
}

const RETIRED_MIGRATION_PROBE_RESPONSE = {
  code: 'migration_probe_retired',
  error:
    'This legacy schema probe is retired. Verify database changes through the controlled migration replay pipeline.',
} as const;

function retiredMigrationProbeResponse() {
  return NextResponse.json(RETIRED_MIGRATION_PROBE_RESPONSE, { status: 410 });
}

/** Retired legacy schema probe. Database changes now use the replayed migration pipeline. */
export async function POST(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('operations.read');
  if (auth.status !== 'authenticated') return authError(auth.status);

  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  return retiredMigrationProbeResponse();
}

export async function GET() {
  const auth = await getPlatformAdminAuthForPermission('operations.read');
  if (auth.status !== 'authenticated') return authError(auth.status);

  return retiredMigrationProbeResponse();
}
