import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import {
  type PlatformSettingsResponse,
  PlatformSettingsResponseSchema,
  type PlatformSettingsSecretStatus,
  PlatformSettingsUpdateSchema,
} from './schema';

export type { PlatformSettingsResponse, PlatformSettingsSecretStatus };

type SettingsRpcError = { code?: string | null; message: string };
type SettingsRpcResult = { data: unknown; error: SettingsRpcError | null };
type SettingsRpc = {
  rpc(name: 'get_admin_platform_settings_v1'): Promise<SettingsRpcResult>;
  rpc(
    name: 'update_admin_platform_settings_v1',
    args: { p_settings: Record<string, unknown> }
  ): Promise<SettingsRpcResult>;
};

function platformAuthError(status: 'forbidden' | 'unauthenticated') {
  return NextResponse.json(
    { error: status === 'unauthenticated' ? 'Unauthorized' : 'Forbidden' },
    { status: status === 'unauthenticated' ? 401 : 403 }
  );
}

function parseSafeSettings(data: unknown): PlatformSettingsResponse | null {
  const parsed = PlatformSettingsResponseSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  logger.error({
    message: 'Invalid safe platform settings RPC payload',
    error: parsed.error,
  });
  return null;
}

async function readSafeSettings(rpc: SettingsRpc): Promise<{
  data: PlatformSettingsResponse | null;
  error: SettingsRpcError | null;
}> {
  const result = await rpc.rpc('get_admin_platform_settings_v1');
  if (result.error) return { data: null, error: result.error };
  const data = parseSafeSettings(result.data);
  return data
    ? { data, error: null }
    : {
        data: null,
        error: {
          code: 'INVALID_PLATFORM_SETTINGS_PAYLOAD',
          message: 'Safe platform settings RPC returned an invalid payload.',
        },
      };
}

export async function GET() {
  const auth = await getPlatformAdminAuthForPermission('settings.read');
  if (auth.status !== 'authenticated') return platformAuthError(auth.status);

  try {
    const supabase = await createClient();
    const result = await readSafeSettings(supabase as unknown as SettingsRpc);
    if (result.error || !result.data) {
      logger.error({
        message: 'Platform settings safe read failed',
        error: result.error,
      });
      return NextResponse.json(
        { error: 'Failed to fetch settings' },
        { status: 500 }
      );
    }
    return NextResponse.json(result.data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    logger.error({ message: 'Platform settings GET error', error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('settings.manage');
  if (auth.status !== 'authenticated') return platformAuthError(auth.status);

  try {
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
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    const parsed = PlatformSettingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json(
        { error: 'At least one setting must be provided' },
        { status: 400 }
      );
    }

    const rpc = (await createClient()) as unknown as SettingsRpc;
    const update = await rpc.rpc('update_admin_platform_settings_v1', {
      p_settings: parsed.data,
    });
    if (update.error) {
      logger.error({
        message: 'Platform settings safe update failed',
        error: update.error,
      });
      return NextResponse.json(
        { error: 'Failed to update settings' },
        { status: 500 }
      );
    }

    const result = await readSafeSettings(rpc);
    if (result.error || !result.data) {
      logger.error({
        message: 'Platform settings post-update read failed',
        error: result.error,
      });
      return NextResponse.json(
        { error: 'Failed to fetch updated settings' },
        { status: 500 }
      );
    }
    return NextResponse.json(result.data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    logger.error({ message: 'Platform settings PUT error', error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
