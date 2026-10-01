import { type NextRequest, NextResponse } from 'next/server';
import { listAdminAuditEvents } from '@/lib/admin-audit';
import { getAdminAuditAccess } from '@/lib/admin-audit-access';
import { createAdminAuditCsv } from '@/lib/admin-audit-csv';
import { checkCsrfProtection } from '@/lib/csrf';
import { writePlatformAuditExportEvent } from '@/lib/platform-audit-export';
import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_AUDIT_MAX_ROWS_PER_REQUEST,
  adminAuditExportSchema,
} from '@/schemas/admin-audit-query';

function auditAccessResponse(status: 'forbidden' | 'unauthenticated') {
  return NextResponse.json(
    { error: status === 'unauthenticated' ? 'Unauthorized' : 'Forbidden' },
    { status: status === 'unauthenticated' ? 401 : 403 }
  );
}

export async function POST(request: NextRequest) {
  const access = await getAdminAuditAccess();
  if (access.status !== 'authorized') {
    return auditAccessResponse(access.status);
  }

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid audit export query' },
      { status: 400 }
    );
  }
  const parsed = adminAuditExportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid audit export query', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const supabase = await createClient();
    const result = await listAdminAuditEvents(supabase, {
      ...parsed.data,
      limit: ADMIN_AUDIT_MAX_ROWS_PER_REQUEST,
    });
    if (result.error || !result.data) {
      console.error('Admin audit export query failed:', result.error);
      return NextResponse.json(
        { error: 'Failed to export platform audit events' },
        { status: result.error?.code === '42501' ? 403 : 500 }
      );
    }

    // Build the artifact before recording a successful export. If formatting
    // fails, no audit row should claim that a download was produced.
    const csv = createAdminAuditCsv(result.data.events);
    const auditWrite = await writePlatformAuditExportEvent(supabase);
    if (auditWrite.error) {
      console.error('Admin audit export write failed:', auditWrite.error);
      return NextResponse.json(
        { error: 'Failed to record audit export' },
        { status: auditWrite.error.code === '42501' ? 403 : 500 }
      );
    }

    const isPartial = result.data.nextCursor !== null;
    const exportScope = isPartial
      ? `partial; first ${ADMIN_AUDIT_MAX_ROWS_PER_REQUEST} matching events`
      : 'complete at query time';
    const filename = isPartial
      ? `baci-platform-audit-first-${ADMIN_AUDIT_MAX_ROWS_PER_REQUEST}-events.csv`
      : 'baci-platform-audit.csv';

    return new NextResponse(csv, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'text/csv; charset=utf-8',
        'X-Baci-Audit-Export-Scope': exportScope,
      },
    });
  } catch (error) {
    console.error('Admin audit export request failed:', error);
    return NextResponse.json(
      { error: 'Failed to export platform audit events' },
      { status: 500 }
    );
  }
}
