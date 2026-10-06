import 'server-only';
import { createHash } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { customerSavingsDraftRuntimeEnabled } from './customer-savings-draft-runtime-gate';

export const customerSavingsDraftRequest = {
  merchantId: '10000000-0000-4000-8000-000000000001',
  failure(status: number, code: string) {
    return NextResponse.json(
      { error: 'Savings draft unavailable', code },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  },
  enabled(request: NextRequest) {
    return customerSavingsDraftRuntimeEnabled({
      requestOrigin: new URL(request.url).origin,
      nodeEnv: process.env.NODE_ENV,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKeySha256: createHash('sha256')
        .update(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '')
        .digest('hex'),
      stagingEnabled: process.env.PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED,
      workerProfile: process.env.BACI_WORKER_PROFILE,
      host: request.headers.get('host') ?? undefined,
      forwardedHost: request.headers.get('x-forwarded-host') ?? undefined,
      forwardedProto: request.headers.get('x-forwarded-proto') ?? undefined,
    });
  },
};
