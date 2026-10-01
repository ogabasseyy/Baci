import { revalidatePath } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { merchantFeatureSettingsDefaults } from '@/lib/merchant-feature-settings-defaults';
import { authorizeRepairsRequest } from '@/lib/repairs/catalog-admin-auth';
import { createClient } from '@/lib/supabase/admin';
import { isMergedRepairPickupPhoneValid } from '@/schemas/is-merged-repair-pickup-phone-valid';
import { repairSettingsSchema } from '@/schemas/merchant-features';

// Private repair-center settings (pickup address + contact). Auth-first
// (repairs.view read / repairs.edit write), CSRF via authorizeRepairsRequest,
// Zod-validated. Written to merchant_feature_settings.repair_settings with the
// service-role client AFTER the permission check — the column is deliberately
// excluded from every public feature projection so the address stays server-only.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function removeUndefinedFields(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  );
}

export async function GET(request: NextRequest) {
  const authz = await authorizeRepairsRequest(request, 'view');
  if (!authz.ok) {
    return authz.response;
  }

  const admin = createClient();
  const { data, error } = await admin
    .from('merchant_feature_settings')
    .select('repair_settings, repairs_catalog_enabled')
    .eq('merchant_id', authz.access.merchantId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load repair settings' },
      { status: 500 }
    );
  }

  const row = data as {
    repair_settings?: unknown;
    repairs_catalog_enabled?: unknown;
  } | null;

  return NextResponse.json({
    repairSettings: row?.repair_settings ?? null,
    repairsCatalogEnabled: row?.repairs_catalog_enabled === true,
  });
}

export async function PATCH(request: NextRequest) {
  const authz = await authorizeRepairsRequest(request, 'edit');
  if (!authz.ok) {
    return authz.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = repairSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const admin = createClient();
  const merchantId = authz.access.merchantId;

  const { data: existing, error: lookupError } = await admin
    .from('merchant_feature_settings')
    .select('merchant_id, repair_settings')
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { error: 'Failed to save repair settings' },
      { status: 500 }
    );
  }

  const existingRow = existing as { repair_settings?: unknown } | null;
  const previousSettings = isRecord(existingRow?.repair_settings)
    ? existingRow.repair_settings
    : {};
  const nextRepairSettings = existing
    ? {
        ...previousSettings,
        ...removeUndefinedFields(parsed.data),
      }
    : removeUndefinedFields(parsed.data);

  if (!isMergedRepairPickupPhoneValid(nextRepairSettings)) {
    return NextResponse.json(
      {
        error: 'Invalid input',
        details: {
          fieldErrors: {
            contact_phone: ['Enter a valid repair-center phone number.'],
          },
        },
      },
      { status: 400 }
    );
  }

  const writeError = existing
    ? (
        await admin
          .from('merchant_feature_settings')
          .update({
            repair_settings: nextRepairSettings,
            updated_at: new Date().toISOString(),
          })
          .eq('merchant_id', merchantId)
      ).error
    : (
        await admin.from('merchant_feature_settings').insert({
          ...merchantFeatureSettingsDefaults.buildFields(),
          merchant_id: merchantId,
          repair_settings: nextRepairSettings,
        })
      ).error;

  if (writeError) {
    return NextResponse.json(
      { error: 'Failed to save repair settings' },
      { status: 500 }
    );
  }

  revalidatePath('/dashboard/repairs');
  return NextResponse.json({ repairSettings: nextRepairSettings });
}
