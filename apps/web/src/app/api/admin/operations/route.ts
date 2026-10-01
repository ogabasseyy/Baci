import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { getAdminOperations } from '@/lib/admin-operations';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import { adminOperationsQuerySchema } from '@/schemas/admin-operations-query';
import type { Database } from '@/types/supabase';

function queryInput(request: NextRequest) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

/** Redacted, read-only cross-merchant operational triage for platform admins. */
export async function GET(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('operations.read');
  if (auth.status === 'unauthenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (auth.status === 'forbidden') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = adminOperationsQuerySchema.safeParse(queryInput(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const supabase =
    (await createClient()) as unknown as SupabaseClient<Database>;
  const { data, error } = await getAdminOperations(supabase, parsed.data);
  if (error || !data) {
    console.error('Admin operations read failed:', error?.code);
    return NextResponse.json(
      { error: 'Failed to load operations' },
      { status: error?.code === '42501' ? 403 : 500 }
    );
  }

  return NextResponse.json({
    ...data,
    capabilities: {
      canReadFinancials: auth.context.permissions.includes('financials.read'),
      canReplay: auth.context.permissions.includes('operations.manage'),
    },
  });
}
