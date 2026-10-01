import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';

interface MarkAllVisibleNotificationsResult {
  remaining_unread_count: number;
  updated_count: number;
}

function isMarkAllVisibleNotificationsResult(
  value: unknown
): value is MarkAllVisibleNotificationsResult {
  if (typeof value !== 'object' || value === null) return false;
  if (!('updated_count' in value) || !('remaining_unread_count' in value)) {
    return false;
  }

  return (
    typeof value.updated_count === 'number' &&
    Number.isSafeInteger(value.updated_count) &&
    value.updated_count >= 0 &&
    typeof value.remaining_unread_count === 'number' &&
    Number.isSafeInteger(value.remaining_unread_count) &&
    value.remaining_unread_count >= 0
  );
}

/**
 * PATCH /api/notifications/mark-all-read
 * Mark all unread notifications for the current merchant as read
 */
export async function PATCH(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Auth is intentionally evaluated before CSRF for every protected mutation.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant (supports both owners and staff)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const merchantId = merchantContext.merchantId;
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'dashboard', 'view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const csrfCheck = await checkCsrfProtection(request);
    if (!csrfCheck.valid) {
      return (
        csrfCheck.response ||
        NextResponse.json(
          { error: 'Invalid or missing CSRF token' },
          { status: 403 }
        )
      );
    }

    const { data: result, error } = await supabase
      .rpc('mark_all_visible_merchant_notifications_read_v1', {
        p_merchant_id: merchantId,
      })
      .single();

    if (error || !isMarkAllVisibleNotificationsResult(result)) {
      console.error('Failed to mark all visible notifications as read');
      return NextResponse.json(
        { error: 'Failed to mark all notifications as read' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      updated_count: result.updated_count,
      unread_count: result.remaining_unread_count,
    });
  } catch (error) {
    console.error('Notifications mark all read PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to mark all notifications as read' },
      { status: 500 }
    );
  }
}
