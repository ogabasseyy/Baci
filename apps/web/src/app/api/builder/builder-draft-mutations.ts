import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { BUILDER_PRIVATE_STORAGE_ENABLED } from '@/config/builder-private-storage';
import { mutatePrivateBrowserDraft } from '@/lib/website-builder/browser-private-drafts';
import type {
  BuilderConfigInput,
  BuilderCreateInput,
  BuilderPublishInput,
} from '@/schemas/builder';

interface PageConfigMetaRecord {
  id: string;
  updated_at: string | null;
}

interface PublishablePageConfigRecord extends PageConfigMetaRecord {
  draft_config: BuilderConfigInput | null;
  published_config: BuilderConfigInput | null;
  draft_seo: unknown | null;
  draft_store_settings: unknown | null;
  draft_setup_settings: unknown | null;
}

type MutationResult =
  | { response: NextResponse; data?: never; lastUpdated?: never }
  | {
      response?: never;
      data: Record<string, unknown>;
      lastUpdated: string | null;
    };

function createConflictResponse() {
  return NextResponse.json(
    {
      error: 'Builder draft is out of date',
      code: 'stale_builder_draft',
      message:
        'This builder draft changed in another session. Refresh the page to continue editing the latest version.',
    },
    { status: 409 }
  );
}

function createInternalServerErrorResponse(message = 'Internal server error') {
  return NextResponse.json({ error: message }, { status: 500 });
}

function getPageConfigMeta(
  supabase: SupabaseClient,
  merchantId: string,
  pageSlug: string
) {
  return supabase
    .from('page_configs')
    .select('id, updated_at')
    .eq('merchant_id', merchantId)
    .eq('page_slug', pageSlug)
    .maybeSingle<PageConfigMetaRecord>();
}

function getPublishablePageConfig(
  supabase: SupabaseClient,
  merchantId: string,
  pageSlug: string
) {
  return supabase
    .from('page_configs')
    .select(
      'id, draft_config, published_config, draft_seo, draft_store_settings, draft_setup_settings, updated_at'
    )
    .eq('merchant_id', merchantId)
    .eq('page_slug', pageSlug)
    .maybeSingle<PublishablePageConfigRecord>();
}

function isConflict(
  expectedLastUpdated: string | null | undefined,
  currentLastUpdated: string | null
) {
  return (
    expectedLastUpdated !== undefined &&
    expectedLastUpdated !== currentLastUpdated
  );
}

export async function saveBuilderDraft(
  supabase: SupabaseClient,
  merchantId: string,
  input: Omit<BuilderCreateInput, 'merchantId'>
): Promise<MutationResult> {
  if (BUILDER_PRIVATE_STORAGE_ENABLED)
    return mutatePrivateBrowserDraft(supabase, merchantId, input);
  const {
    slug,
    config,
    name,
    seo,
    storeSettings,
    setupSettings,
    expectedLastUpdated,
  } = input;

  const { data: currentConfig, error: currentConfigError } =
    await getPageConfigMeta(supabase, merchantId, slug);

  if (currentConfigError && currentConfigError.code !== 'PGRST116') {
    return {
      response: createInternalServerErrorResponse(),
    };
  }

  if (isConflict(expectedLastUpdated, currentConfig?.updated_at || null)) {
    return { response: createConflictResponse() };
  }

  const updatedAt = new Date().toISOString();

  if (currentConfig) {
    const { data, error } = await supabase
      .from('page_configs')
      .update({
        page_name: name,
        draft_config: config,
        draft_seo: seo,
        draft_store_settings: storeSettings,
        draft_setup_settings: setupSettings,
        updated_at: updatedAt,
      })
      .eq('id', currentConfig.id)
      .eq('merchant_id', merchantId)
      .eq('updated_at', currentConfig.updated_at)
      .select(
        'id, merchant_id, page_slug, draft_config, draft_seo, draft_store_settings, draft_setup_settings, updated_at'
      )
      .maybeSingle();

    if (error) {
      console.error('Failed to update builder draft:', {
        merchantId,
        slug,
        error,
      });
      return {
        response: createInternalServerErrorResponse(),
      };
    }

    if (!data) {
      return { response: createConflictResponse() };
    }

    return { data, lastUpdated: data.updated_at ?? null };
  }

  if (expectedLastUpdated !== undefined && expectedLastUpdated !== null) {
    return { response: createConflictResponse() };
  }

  const { data, error } = await supabase
    .from('page_configs')
    .upsert(
      {
        merchant_id: merchantId,
        page_slug: slug,
        page_name: name,
        draft_config: config,
        draft_seo: seo,
        draft_store_settings: storeSettings,
        draft_setup_settings: setupSettings,
        updated_at: updatedAt,
      },
      { onConflict: 'merchant_id,page_slug', ignoreDuplicates: true }
    )
    .select(
      'id, merchant_id, page_slug, draft_config, draft_seo, draft_store_settings, draft_setup_settings, updated_at'
    )
    .maybeSingle();

  if (error) {
    console.error('Failed to insert builder draft:', {
      merchantId,
      slug,
      error,
    });
    return {
      response: createInternalServerErrorResponse(),
    };
  }

  if (!data) {
    return { response: createConflictResponse() };
  }

  return { data, lastUpdated: data.updated_at ?? null };
}

export async function publishBuilderDraft(
  supabase: SupabaseClient,
  merchantId: string,
  input: Omit<BuilderPublishInput, 'merchantId'>
): Promise<MutationResult> {
  if (BUILDER_PRIVATE_STORAGE_ENABLED)
    return mutatePrivateBrowserDraft(supabase, merchantId, input);
  const { slug, expectedLastUpdated } = input;
  const publishedAt = new Date().toISOString();

  const { data: currentConfig, error: draftError } =
    await getPublishablePageConfig(supabase, merchantId, slug);

  if (draftError) {
    return {
      response: createInternalServerErrorResponse(),
    };
  }

  if (!currentConfig?.draft_config) {
    return {
      response: NextResponse.json(
        { error: 'No draft to publish' },
        { status: 400 }
      ),
    };
  }

  if (isConflict(expectedLastUpdated, currentConfig.updated_at || null)) {
    return { response: createConflictResponse() };
  }

  const { data, error } = await supabase
    .from('page_configs')
    .update({
      published_config: currentConfig.draft_config,
      published_seo: currentConfig.draft_seo,
      published_store_settings: currentConfig.draft_store_settings,
      published_setup_settings: currentConfig.draft_setup_settings,
      is_published: true,
      published_at: publishedAt,
      updated_at: publishedAt,
    })
    .eq('id', currentConfig.id)
    .eq('merchant_id', merchantId)
    .eq('updated_at', currentConfig.updated_at)
    .select('id, updated_at')
    .maybeSingle();

  if (error) {
    return {
      response: createInternalServerErrorResponse(),
    };
  }

  if (!data) {
    return { response: createConflictResponse() };
  }

  if (currentConfig.published_config) {
    const { error: historyError } = await supabase
      .from('page_config_history')
      .insert({
        page_config_id: currentConfig.id,
        config: currentConfig.published_config,
        version_note: `Published on ${publishedAt}`,
      });

    if (historyError) {
      console.error('Failed to save config history after publish:', {
        merchantId,
        slug,
        error: historyError,
      });
    }
  }

  return { data, lastUpdated: data.updated_at ?? null };
}
