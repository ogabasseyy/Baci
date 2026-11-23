import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import z from 'zod';
import { parseRequestedMerchantId } from '@/app/api/branches/branch-route-utils';
import { isAgenticTenantVisible } from '@/app/dashboard/agentic-tenant-navigation';
import { getConfiguredAgenticMerchantSlug } from '@/lib/agentic/agentic-merchant-slug';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import {
  chatAlertLevelSchema,
  chatNotificationSettingsPatchSchema,
} from '@/schemas/chat-notification-settings';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function respond(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

type Resolved =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      merchantId: string;
      supabase: Awaited<ReturnType<typeof createClient>>;
      access: ReturnType<typeof toUserAccess>;
    };

/**
 * Auth, merchant and chat-tenant resolution shared by GET and PATCH. The store
 * is the one the dashboard has selected (the established x-baci-merchant-id
 * header), so an owner or staff member of several stores reads and saves the
 * store they are looking at, never the most recently created one.
 */
async function resolveRequest(request: Request): Promise<Resolved> {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: respond(401, { error: 'Unauthorized', code: 'unauthorized' }),
    };
  }
  const requested = parseRequestedMerchantId(request);
  if (requested.response) {
    // Keep this route's { error, code } shape for a malformed store header.
    return {
      ok: false,
      response: respond(400, {
        error: 'Invalid merchant context',
        code: 'invalid_request',
      }),
    };
  }
  const merchant = await getMerchantForApiRequest(supabase, user.id, {
    requestedMerchantId: requested.merchantId,
  });
  if (!merchant) {
    return {
      ok: false,
      response: respond(404, {
        error: 'Merchant not found',
        code: 'merchant_not_found',
      }),
    };
  }
  // Chat is live for the configured tenant only; others see nothing.
  if (
    !isAgenticTenantVisible(
      merchant.merchantSlug,
      getConfiguredAgenticMerchantSlug()
    )
  ) {
    return {
      ok: false,
      response: respond(404, { error: 'Not available', code: 'not_available' }),
    };
  }
  return {
    ok: true,
    merchantId: merchant.merchantId,
    supabase,
    access: toUserAccess(merchant),
  };
}

/** GET: which customer-chat events alert the merchant (all, handover, off). */
export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveRequest(request);
    if (!resolved.ok) return resolved.response;
    if (!hasPermission(resolved.access, 'dashboard', 'view')) {
      return respond(403, {
        error: 'Permission denied',
        code: 'permission_denied',
      });
    }
    const { data, error } = await resolved.supabase.rpc(
      'get_chat_message_alert_level',
      { p_merchant_id: resolved.merchantId }
    );
    const level = chatAlertLevelSchema.safeParse(data);
    if (error || !level.success) {
      console.error('Chat notification settings read failed', error?.code);
      return respond(500, {
        error: 'Failed to load settings',
        code: 'read_failed',
      });
    }
    return respond(200, { level: level.data });
  } catch {
    return respond(500, {
      error: 'Failed to load settings',
      code: 'read_failed',
    });
  }
}

/** PATCH: choose which customer-chat events alert the merchant. */
export async function PATCH(request: NextRequest) {
  try {
    const resolved = await resolveRequest(request);
    if (!resolved.ok) return resolved.response;
    if (!hasPermission(resolved.access, 'settings', 'edit')) {
      return respond(403, {
        error: 'Permission denied',
        code: 'permission_denied',
      });
    }
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) {
      return (
        csrf.response ??
        respond(403, { error: 'CSRF validation failed', code: 'csrf_failed' })
      );
    }
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return respond(400, {
        error: 'Invalid request',
        code: 'invalid_request',
      });
    }
    const parsed = chatNotificationSettingsPatchSchema.safeParse(json);
    if (!parsed.success) {
      return respond(400, {
        error: 'Invalid request',
        code: 'invalid_request',
        details: z.flattenError(parsed.error),
      });
    }
    const { data, error } = await resolved.supabase.rpc(
      'set_chat_message_alert_level',
      {
        p_merchant_id: resolved.merchantId,
        p_level: parsed.data.level,
      }
    );
    const saved = chatAlertLevelSchema.safeParse(data);
    if (error || !saved.success) {
      console.error('Chat notification settings save failed', error?.code);
      return respond(500, {
        error: 'Failed to save settings',
        code: 'save_failed',
      });
    }
    return respond(200, { level: saved.data });
  } catch {
    return respond(500, {
      error: 'Failed to save settings',
      code: 'save_failed',
    });
  }
}
