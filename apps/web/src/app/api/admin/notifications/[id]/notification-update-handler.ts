import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import {
  mergedNotificationTargetingSchema,
  updateNotificationSchema,
} from '@/schemas/notifications';

export async function updateAdminNotification(request: Request, id: string) {
  const json = await parseRequestBody(request);
  if (json instanceof NextResponse) return json;
  const parsed = updateNotificationSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: z.flattenError(parsed.error) },
      { status: 400 }
    );
  }

  try {
    const supabase = await createClient();
    const { data: existing, error: fetchError } = await supabase
      .from('notifications')
      .select(
        'id, sent_at, delivery_state, delivery_attempts, target_type, target_segment, scheduled_for, expires_at'
      )
      .eq('id', id)
      .single();
    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }
    if (
      existing.sent_at ||
      existing.delivery_state !== 'pending' ||
      existing.delivery_attempts > 0
    ) {
      return NextResponse.json(
        { error: 'Only undelivered pending notifications can be updated' },
        { status: 409 }
      );
    }

    const body = parsed.data;
    const effectiveTargeting = normalizeEffectiveTargeting(existing, body);
    const validationResponse = await validateEffectiveUpdate(
      supabase,
      existing,
      body,
      effectiveTargeting
    );
    if (validationResponse) return validationResponse;

    const updates = buildUpdates(body, effectiveTargeting);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }
    const { data: updated, error } = await supabase
      .from('notifications')
      .update(updates)
      .eq('id', id)
      .eq('delivery_state', 'pending')
      .eq('delivery_attempts', 0)
      .is('sent_at', null)
      .select(
        'id, title, message, notification_type, priority, target_type, target_segment, channels, action_url, action_label, scheduled_for, sent_at, expires_at, created_at, created_by'
      )
      .maybeSingle();
    if (error) {
      logger.error({ message: 'Error updating notification', error, id });
      return NextResponse.json(
        { error: 'Failed to update notification' },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Notification delivery has already started or completed' },
        { status: 409 }
      );
    }
    return NextResponse.json({ ...updated, target_merchant_ids: [] });
  } catch (error) {
    logger.error({ message: 'Admin notification PATCH error', error });
    return NextResponse.json(
      { error: 'Failed to update notification' },
      { status: 500 }
    );
  }
}

async function parseRequestBody(
  request: Request
): Promise<unknown | NextResponse> {
  try {
    return await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}

async function validateEffectiveUpdate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  existing: {
    target_type: 'all' | 'specific' | 'segment' | null;
    target_segment: 'new' | 'active' | 'at_risk' | null;
    scheduled_for: string | null;
    expires_at: string | null;
  },
  body: ReturnType<typeof updateNotificationSchema.parse>,
  effectiveTargeting: EffectiveTargeting
) {
  const effectiveScheduledFor = body.scheduled_for ?? existing.scheduled_for;
  // `null` is an intentional clear; only an omitted field inherits the
  // persisted expiration.
  const effectiveExpiresAt =
    body.expires_at !== undefined ? body.expires_at : existing.expires_at;
  if (
    effectiveExpiresAt &&
    new Date(effectiveExpiresAt).getTime() <=
      (effectiveScheduledFor
        ? new Date(effectiveScheduledFor).getTime()
        : Date.now())
  ) {
    return NextResponse.json(
      { error: 'Expiration must be after the effective send time' },
      { status: 400 }
    );
  }
  const changesTargeting =
    body.target_type !== undefined ||
    body.target_merchant_ids !== undefined ||
    body.target_segment !== undefined;
  if (!changesTargeting) return;

  const targeting = mergedNotificationTargetingSchema.safeParse({
    target_merchant_ids: effectiveTargeting.target_merchant_ids ?? undefined,
    target_segment: effectiveTargeting.target_segment ?? undefined,
    target_type: effectiveTargeting.target_type,
  });
  if (!targeting.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: z.flattenError(targeting.error) },
      { status: 400 }
    );
  }
  if (
    targeting.data.target_type === 'specific' &&
    targeting.data.target_merchant_ids?.length
  ) {
    const targetIds = targeting.data.target_merchant_ids;
    const targetsClient = supabase as unknown as {
      rpc: (
        name: 'resolve_admin_notification_target_merchant_ids_v1',
        args: { p_merchant_ids: string[] }
      ) => Promise<{ data: string[] | null; error: unknown }>;
    };
    const { data, error } = await targetsClient.rpc(
      'resolve_admin_notification_target_merchant_ids_v1',
      { p_merchant_ids: targetIds }
    );
    if (error || (data?.length ?? 0) !== targetIds.length) {
      return NextResponse.json(
        { error: 'One or more target merchants do not exist' },
        { status: 400 }
      );
    }
  }
}

type EffectiveTargeting = {
  target_merchant_ids: string[] | null;
  target_segment: 'new' | 'active' | 'at_risk' | null;
  target_type: 'all' | 'specific' | 'segment' | undefined;
};

function normalizeEffectiveTargeting(
  existing: {
    target_type: 'all' | 'specific' | 'segment' | null;
    target_segment: 'new' | 'active' | 'at_risk' | null;
  },
  body: ReturnType<typeof updateNotificationSchema.parse>
): EffectiveTargeting {
  const target_type = body.target_type ?? existing.target_type ?? undefined;
  const target_merchant_ids = body.target_merchant_ids ?? null;
  const target_segment =
    body.target_type === 'segment'
      ? (body.target_segment ?? null)
      : body.target_segment !== undefined
        ? body.target_segment
        : existing.target_segment;

  if (target_type === 'all') {
    return {
      target_merchant_ids: null,
      target_segment: null,
      target_type,
    };
  }
  if (target_type === 'specific') {
    return {
      target_merchant_ids,
      target_segment: null,
      target_type,
    };
  }
  if (target_type === 'segment') {
    return {
      target_merchant_ids: null,
      target_segment,
      target_type,
    };
  }
  return { target_merchant_ids, target_segment, target_type };
}

function buildUpdates(
  body: ReturnType<typeof updateNotificationSchema.parse>,
  effectiveTargeting: EffectiveTargeting
) {
  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title.trim();
  if (body.message !== undefined) updates.message = body.message.trim();
  if (body.notification_type !== undefined)
    updates.notification_type = body.notification_type;
  if (body.priority !== undefined) updates.priority = body.priority;
  const changesTargeting =
    body.target_type !== undefined ||
    body.target_merchant_ids !== undefined ||
    body.target_segment !== undefined;
  if (changesTargeting) {
    updates.target_type = effectiveTargeting.target_type;
    updates.target_merchant_ids = effectiveTargeting.target_merchant_ids;
    updates.target_segment = effectiveTargeting.target_segment;
  }
  if (body.channels !== undefined) updates.channels = body.channels;
  if (body.action_url !== undefined) updates.action_url = body.action_url;
  if (body.action_label !== undefined) updates.action_label = body.action_label;
  if (body.scheduled_for !== undefined)
    updates.scheduled_for = body.scheduled_for;
  if (body.expires_at !== undefined) updates.expires_at = body.expires_at;
  return updates;
}
