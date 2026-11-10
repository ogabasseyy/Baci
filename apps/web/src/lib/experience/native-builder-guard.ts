import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { readExperienceAuthoringMode } from './authoring-mode';
import { getExperienceOwnerRuntime } from './owner-runtime';
/** SQL remains authoritative even when the optional UI/runtime is uninstalled. */
export async function denyNativeLegacyMutation(
  client: SupabaseClient,
  merchantId: string
) {
  if (!getExperienceOwnerRuntime()?.approval) return null;
  const mode = await readExperienceAuthoringMode(client, merchantId);
  if (mode === 'legacy') return null;
  return NextResponse.json(
    {
      error:
        mode === 'full-code'
          ? 'Open the full-code workspace to edit this store.'
          : 'Builder mode unavailable.',
      code: 'builder_authoring_mode_unavailable',
      editorUrl: `/builder/experience?merchant=${encodeURIComponent(merchantId)}`,
    },
    { status: mode === 'full-code' ? 409 : 503 }
  );
}
