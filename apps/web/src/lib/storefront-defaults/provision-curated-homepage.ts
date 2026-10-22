import { z } from 'zod';
import { BUILDER_PRIVATE_STORAGE_ENABLED } from '@/config/builder-private-storage';
import { generateInitialTemplate } from '@/lib/initial-template-generator';
import type { BrandColors } from '@/types';

type Stage = 'auth' | 'template' | 'insert' | 'read_after_conflict';

export type CuratedHomepageProvisionResult =
  | { status: 'created'; updatedAt: string | null }
  | { status: 'already_exists'; updatedAt: string | null }
  | { status: 'failed'; stage: Stage };

interface CuratedHomepageClient {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: 'page_configs') => unknown;
  rpc?: (
    name: 'builder_private_onboard',
    args: { p_merchant_id: string; p_config: unknown }
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}

interface ProvisionCuratedHomepageInput {
  supabase: CuratedHomepageClient;
  expectedOwnerUserId: string;
  merchantId: string;
  merchantSlug: string;
  merchantLogoUrl?: string | null;
  businessName: string;
  businessType: string;
  brandColors: BrandColors;
}

interface PageConfigQuery {
  insert: (row: Record<string, unknown>) => {
    select: (columns: 'updated_at') => {
      maybeSingle: () => Promise<{
        data: { updated_at: string | null } | null;
        error: unknown;
      }>;
    };
  };
  select: (columns: 'updated_at') => {
    eq: (
      column: 'merchant_id',
      value: string
    ) => {
      eq: (
        column: 'page_slug',
        value: 'home'
      ) => {
        maybeSingle: () => Promise<{
          data: { updated_at: string | null } | null;
          error: unknown;
        }>;
      };
    };
  };
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}

function logFailure(merchantId: string, stage: Stage, error: unknown): void {
  console.error('curated-homepage-provisioning', {
    merchantId,
    stage,
    pgCode: postgresCode(error),
  });
}

export async function provisionCuratedHomepage({
  supabase,
  expectedOwnerUserId,
  merchantId,
  merchantSlug,
  merchantLogoUrl,
  businessName,
  businessType,
  brandColors,
}: ProvisionCuratedHomepageInput): Promise<CuratedHomepageProvisionResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id !== expectedOwnerUserId)
    return { status: 'failed', stage: 'auth' };

  let config: Awaited<ReturnType<typeof generateInitialTemplate>>;
  try {
    config = await generateInitialTemplate({
      businessName,
      businessType,
      brandColors,
      merchant: {
        id: merchantId,
        slug: merchantSlug,
        ...(merchantLogoUrl ? { logo_url: merchantLogoUrl } : {}),
      },
    });
  } catch (error) {
    logFailure(merchantId, 'template', error);
    return { status: 'failed', stage: 'template' };
  }

  const pageConfigs = supabase.from('page_configs') as PageConfigQuery;
  if (BUILDER_PRIVATE_STORAGE_ENABLED) {
    if (!supabase.rpc) return { status: 'failed', stage: 'insert' };
    const { data, error } = await supabase.rpc('builder_private_onboard', {
      p_merchant_id: merchantId,
      p_config: config,
    });
    if (error) {
      logFailure(merchantId, 'insert', error);
      return { status: 'failed', stage: 'insert' };
    }
    const receipt = z
      .object({ updated_at: z.string().nullable() })
      .safeParse(data);
    if (receipt.success)
      return { status: 'created', updatedAt: receipt.data.updated_at };
    if (
      z.object({ code: z.literal('already_exists') }).safeParse(data).success
    ) {
      const current = await pageConfigs
        .select('updated_at')
        .eq('merchant_id', merchantId)
        .eq('page_slug', 'home')
        .maybeSingle();
      if (!current.error && current.data)
        return { status: 'already_exists', updatedAt: current.data.updated_at };
    }
    return { status: 'failed', stage: 'insert' };
  }
  const { data, error } = await pageConfigs
    .insert({
      merchant_id: merchantId,
      page_slug: 'home',
      page_name: 'Home',
      draft_config: config,
      published_config: config,
      is_published: true,
    })
    .select('updated_at')
    .maybeSingle();
  if (!error && data) return { status: 'created', updatedAt: data.updated_at };
  if (postgresCode(error) !== '23505') {
    logFailure(merchantId, 'insert', error);
    return { status: 'failed', stage: 'insert' };
  }

  const reread = await pageConfigs
    .select('updated_at')
    .eq('merchant_id', merchantId)
    .eq('page_slug', 'home')
    .maybeSingle();
  if (reread.data && !reread.error)
    return { status: 'already_exists', updatedAt: reread.data.updated_at };
  logFailure(merchantId, 'read_after_conflict', reread.error);
  return { status: 'failed', stage: 'read_after_conflict' };
}
