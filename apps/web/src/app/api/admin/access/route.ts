import { type NextRequest, NextResponse } from 'next/server';
import {
  listAdminPlatformAccess,
  revokeAdminPlatformAccess,
  upsertAdminPlatformAccess,
} from '@/lib/admin-platform-access';
import { getAdminPlatformAccessAuth } from '@/lib/admin-platform-access-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/server';
import {
  adminPlatformAccessListSchema,
  adminPlatformAccessRevokeSchema,
  adminPlatformAccessUpsertSchema,
} from '@/schemas/admin-platform-access';

function accessErrorResponse(status: 'forbidden' | 'unauthenticated') {
  return NextResponse.json(
    { error: status === 'unauthenticated' ? 'Unauthorized' : 'Forbidden' },
    { status: status === 'unauthenticated' ? 401 : 403 }
  );
}

function mutationErrorStatus(code: string | undefined): number {
  if (
    code === '42501' ||
    code === '28000' ||
    code === 'P0002' ||
    code === '22023'
  ) {
    return code === '42501' || code === '28000' ? 403 : 400;
  }
  return 500;
}

async function getAuthorizedAccessClient() {
  const access = await getAdminPlatformAccessAuth();
  if (access.status !== 'authorized') {
    return { access, supabase: null };
  }
  return { access, supabase: await createClient() };
}

export async function GET(request: NextRequest) {
  const { access, supabase } = await getAuthorizedAccessClient();
  if (access.status !== 'authorized' || !supabase) {
    return accessErrorResponse(
      access.status === 'unauthenticated' ? 'unauthenticated' : 'forbidden'
    );
  }

  const parsed = adminPlatformAccessListSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid access query', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await listAdminPlatformAccess(
    supabase,
    parsed.data.limit,
    parsed.data.offset
  );
  if (result.error || !result.data) {
    return NextResponse.json(
      { error: 'Failed to load platform access' },
      { status: mutationErrorStatus(result.error?.code) }
    );
  }

  return NextResponse.json(
    {
      data: result.data,
      generatedAt: new Date().toISOString(),
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      truncated: result.data.length >= parsed.data.limit,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const { access, supabase } = await getAuthorizedAccessClient();
  if (access.status !== 'authorized' || !supabase) {
    return accessErrorResponse(
      access.status === 'unauthenticated' ? 'unauthenticated' : 'forbidden'
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
  const parsed = adminPlatformAccessUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid platform access request',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const result = await upsertAdminPlatformAccess(supabase, parsed.data);
  if (result.error || !result.data?.[0]) {
    return NextResponse.json(
      { error: 'Platform access was not updated' },
      { status: mutationErrorStatus(result.error?.code) }
    );
  }

  return NextResponse.json(
    { data: result.data[0] },
    { headers: { 'Cache-Control': 'no-store' }, status: 200 }
  );
}

export async function DELETE(request: NextRequest) {
  const { access, supabase } = await getAuthorizedAccessClient();
  if (access.status !== 'authorized' || !supabase) {
    return accessErrorResponse(
      access.status === 'unauthenticated' ? 'unauthenticated' : 'forbidden'
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
  const parsed = adminPlatformAccessRevokeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid platform access revocation',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const result = await revokeAdminPlatformAccess(supabase, parsed.data);
  if (result.error || !result.data?.[0]) {
    return NextResponse.json(
      { error: 'Platform access was not revoked' },
      { status: mutationErrorStatus(result.error?.code) }
    );
  }

  return NextResponse.json(
    { data: result.data[0] },
    { headers: { 'Cache-Control': 'no-store' }, status: 200 }
  );
}
