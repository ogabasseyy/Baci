import { type NextRequest, NextResponse } from 'next/server';
import { listAdminAuditEvents } from '@/lib/admin-audit';
import { getAdminAuditAccess } from '@/lib/admin-audit-access';
import { createClient } from '@/lib/supabase/server';
import { adminAuditQuerySchema } from '@/schemas/admin-audit-query';

function auditAccessResponse(status: 'forbidden' | 'unauthenticated') {
  return NextResponse.json(
    { error: status === 'unauthenticated' ? 'Unauthorized' : 'Forbidden' },
    { status: status === 'unauthenticated' ? 401 : 403 }
  );
}

export async function GET(request: NextRequest) {
  const access = await getAdminAuditAccess();
  if (access.status !== 'authorized') {
    return auditAccessResponse(access.status);
  }

  const parsed = adminAuditQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid audit query', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const supabase = await createClient();
    const result = await listAdminAuditEvents(supabase, parsed.data);
    if (result.error || !result.data) {
      console.error('Admin audit timeline query failed:', result.error);
      return NextResponse.json(
        { error: 'Failed to load platform audit events' },
        { status: result.error?.code === '42501' ? 403 : 500 }
      );
    }

    return NextResponse.json(
      { data: result.data, generatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Admin audit timeline request failed:', error);
    return NextResponse.json(
      { error: 'Failed to load platform audit events' },
      { status: 500 }
    );
  }
}
