import { type NextRequest, NextResponse } from 'next/server';
import { getAdminReconciliation } from '@/lib/admin-reconciliation';
import { buildAdminReconciliationCsv } from '@/lib/admin-reconciliation-csv';
import { writeAdminReconciliationExportEvent } from '@/lib/admin-reconciliation-export-audit';
import { checkCsrfProtection } from '@/lib/csrf';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import { adminReconciliationQuerySchema } from '@/schemas/admin-reconciliation-query';

const CSV_EXPORT_LIMIT = 100;

function invalidQueryResponse(message: string) {
  return NextResponse.json(
    { code: 'INVALID_QUERY', error: message },
    { status: 400 }
  );
}

/**
 * Returns fixed, redacted reconciliation data only. CSV generation is a
 * CSRF-protected POST so its mandatory audit event cannot be forged by a GET.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getPlatformAdminAuthForPermission('financials.read');
    if (auth.status === 'unauthenticated') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.status === 'forbidden') {
      return NextResponse.json(
        { error: 'Forbidden - financial read access required' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = adminReconciliationQuerySchema.safeParse({
      currency: searchParams.get('currency') ?? undefined,
      cursorAt: searchParams.get('cursorAt') ?? undefined,
      cursorId: searchParams.get('cursorId') ?? undefined,
      format: searchParams.get('format') ?? undefined,
      lane: searchParams.get('lane') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      merchantId: searchParams.get('merchantId') ?? undefined,
      period: searchParams.get('period') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    });
    if (!parsed.success) {
      return invalidQueryResponse(
        parsed.error.issues[0]?.message ?? 'Invalid reconciliation query.'
      );
    }
    if (parsed.data.format === 'csv') {
      return invalidQueryResponse('CSV export requires a POST request.');
    }

    const query = parsed.data;
    const supabase = await createClient();
    const { data, error } = await getAdminReconciliation(supabase, query);
    if (error || !data) {
      console.error('Admin reconciliation read model error:', error?.code);
      return NextResponse.json(
        { error: 'Failed to fetch reconciliation data' },
        { status: error?.code === '42501' ? 403 : 500 }
      );
    }

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    console.error('Admin reconciliation route failed');
    return NextResponse.json(
      { error: 'Failed to fetch reconciliation data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getPlatformAdminAuthForPermission('financials.read');
    if (auth.status === 'unauthenticated') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.status === 'forbidden') {
      return NextResponse.json(
        { error: 'Forbidden - financial read access required' },
        { status: 403 }
      );
    }

    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) {
      return (
        csrf.response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = adminReconciliationQuerySchema.safeParse(body);
    if (!parsed.success || parsed.data.format !== 'csv') {
      return invalidQueryResponse('A valid CSV export request is required.');
    }

    const query = { ...parsed.data, limit: CSV_EXPORT_LIMIT };
    const supabase = await createClient();
    const { data, error } = await getAdminReconciliation(supabase, query);
    if (error || !data) {
      console.error(
        'Admin reconciliation export read model error:',
        error?.code
      );
      return NextResponse.json(
        { error: 'Failed to prepare reconciliation export' },
        { status: error?.code === '42501' ? 403 : 500 }
      );
    }

    const csv = buildAdminReconciliationCsv(data);
    const auditWrite = await writeAdminReconciliationExportEvent(supabase);
    if (auditWrite.error || !auditWrite.data) {
      console.error(
        'Admin reconciliation export audit error:',
        auditWrite.error?.code
      );
      return NextResponse.json(
        { error: 'Failed to record reconciliation export' },
        { status: auditWrite.error?.code === '42501' ? 403 : 500 }
      );
    }

    return new NextResponse(csv, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition':
          'attachment; filename="baci-reconciliation-first-100.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
        'X-Baci-Export-Scope': 'first-100-matching-rows',
      },
    });
  } catch {
    console.error('Admin reconciliation export route failed');
    return NextResponse.json(
      { error: 'Failed to prepare reconciliation export' },
      { status: 500 }
    );
  }
}
