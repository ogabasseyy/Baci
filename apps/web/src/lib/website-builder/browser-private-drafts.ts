import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type {
  BuilderCreateInput,
  BuilderPublishInput,
} from '@/schemas/builder';

const receiptSchema = z.object({
  id: z.uuid(),
  updated_at: z.string().nullable(),
});
const conflict = () => ({
  response: NextResponse.json(
    {
      error: 'Builder draft is out of date',
      code: 'stale_builder_draft',
      message:
        'This builder draft changed in another session. Refresh the page to continue editing the latest version.',
    },
    { status: 409 }
  ),
});
export async function mutatePrivateBrowserDraft(
  client: SupabaseClient,
  merchantId: string,
  input:
    | Omit<BuilderCreateInput, 'merchantId'>
    | Omit<BuilderPublishInput, 'merchantId'>
) {
  const save = 'config' in input;
  // Read once only when the historical browser DTO omitted its optional CAS token.
  let expected = input.expectedLastUpdated;
  if (expected === undefined) {
    const current = await client.rpc('builder_private_load', {
      p_merchant_id: merchantId,
      p_slug: input.slug,
    });
    if (current.error)
      return {
        response: NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        ),
      };
    const row = z
      .object({ updated_at: z.string().nullable() })
      .nullable()
      .safeParse(current.data);
    if (!row.success)
      return {
        response: NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        ),
      };
    expected = row.data?.updated_at ?? null;
  }
  const args = save
    ? {
        p_merchant_id: merchantId,
        p_slug: input.slug,
        p_name: input.name,
        p_config: input.config,
        p_seo: input.seo ?? null,
        p_store: input.storeSettings ?? null,
        p_setup: input.setupSettings ?? null,
        p_expected: expected,
      }
    : {
        p_merchant_id: merchantId,
        p_slug: input.slug,
        p_expected: expected,
        p_scope: 'browser',
      };
  const { data, error } = await client.rpc(
    save ? 'builder_private_save' : 'builder_private_publish',
    args
  );
  if (error?.code === '40001') return conflict();
  if (error)
    return {
      response: NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      ),
    };
  const code = z.object({ code: z.string() }).safeParse(data);
  if (code.success) {
    if (code.data.code === 'stale_builder_draft') return conflict();
    return {
      response: NextResponse.json(
        { error: 'No draft to publish' },
        { status: 400 }
      ),
    };
  }
  const receipt = receiptSchema.safeParse(data);
  if (!receipt.success)
    return {
      response: NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      ),
    };
  return { data: receipt.data, lastUpdated: receipt.data.updated_at };
}
