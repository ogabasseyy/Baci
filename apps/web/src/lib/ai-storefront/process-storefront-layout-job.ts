import type { SupabaseClient } from '@supabase/supabase-js';
import { BUILDER_PRIVATE_STORAGE_ENABLED } from '@/config/builder-private-storage';
import {
  getAiStorefrontDesignRationale,
  normalizeAiStorefrontLayout,
} from '@/lib/ai-storefront/normalize-ai-storefront-layout';
import { generateStorefrontLayoutWithOllama } from '@/lib/ai-storefront/ollama-storefront-client';
import type { StorefrontLayoutJobInput } from '@/schemas/ai-jobs';
import { storedStorefrontLayoutJobInputSchema } from '@/schemas/ai-jobs';
import {
  type BuilderConfigInput,
  builderConfigSchema,
} from '@/schemas/builder';

export interface ProcessStorefrontLayoutJobArgs {
  supabase: SupabaseClient;
  jobId: string;
  merchantId: string;
  input: StorefrontLayoutJobInput;
}

export async function processStorefrontLayoutJob({
  supabase,
  merchantId,
  input,
  jobId,
}: ProcessStorefrontLayoutJobArgs) {
  if (BUILDER_PRIVATE_STORAGE_ENABLED) {
    const stored = storedStorefrontLayoutJobInputSchema.parse(input);
    const { starterConfig, ...semantic } = stored;
    return processStorefrontLayoutSnapshot({
      supabase,
      merchantId,
      input: semantic,
      jobId,
      starterSnapshot: {
        config: starterConfig,
        updatedAt: semantic.createdPageConfigUpdatedAt,
      },
    });
  }
  const { data: pageConfig, error: pageError } = await supabase
    .from('page_configs')
    .select('id, draft_config, updated_at')
    .eq('merchant_id', merchantId)
    .eq('page_slug', input.pageSlug)
    .maybeSingle();

  if (pageError) {
    throw new Error(`Failed to load page config: ${pageError.message}`);
  }
  if (!pageConfig?.draft_config) {
    throw new Error('Starter page config is missing');
  }

  return processStorefrontLayoutSnapshot({
    supabase,
    merchantId,
    input,
    jobId,
    starterSnapshot: {
      config: pageConfig.draft_config,
      updatedAt: pageConfig.updated_at,
    },
  });
}

/** Uses only the starter captured by a normal-client enqueue transaction.
 * The caller must load this from the already owner-protected ai_jobs row.
 * It grants the worker no access to builder_page_drafts.
 */
export async function processStorefrontLayoutSnapshot({
  supabase,
  merchantId,
  input,
  starterSnapshot,
}: ProcessStorefrontLayoutJobArgs & {
  starterSnapshot: { config: unknown; updatedAt: string | null };
}) {
  const parsedStarter = builderConfigSchema.safeParse(starterSnapshot.config);
  if (!parsedStarter.success) {
    throw new Error('Starter page config failed validation');
  }

  const { count: productCount, error: productCountError } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchantId)
    .eq('status', 'active');

  if (productCountError) {
    throw new Error(
      `Failed to load active product count: ${productCountError.message}`
    );
  }

  const layout = await generateStorefrontLayoutWithOllama({
    businessName: input.businessName,
    businessType: input.businessType,
    brandColors: input.brandColors,
    productCount: productCount ?? 0,
  });

  const generatedConfig: BuilderConfigInput = normalizeAiStorefrontLayout({
    businessName: input.businessName,
    layout,
    starterConfig: parsedStarter.data,
  });

  const parsedGenerated = builderConfigSchema.safeParse(generatedConfig);
  if (!parsedGenerated.success) {
    throw new Error('Generated page config failed validation');
  }

  return {
    generatedConfig: parsedGenerated.data,
    designRationale: getAiStorefrontDesignRationale(layout),
    pageSlug: input.pageSlug,
    generatedAgainstUpdatedAt: starterSnapshot.updatedAt,
    applied: false,
    skippedAutoApplyReason:
      starterSnapshot.updatedAt !== input.createdPageConfigUpdatedAt
        ? 'page_config_changed_after_job_created'
        : null,
  };
}
