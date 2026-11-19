import { cacheLife, cacheTag } from 'next/cache';
import { getBlogCacheTag } from '@/lib/blog-cache-tags';
import { getMerchantSafe } from '@/lib/cached-data';
import { createPublicClient } from '@/lib/supabase/anon';
import { getBlogPostsMerchantCacheTag } from '@/lib/tenant-cache-tags';

interface BlogPostRedirectRow {
  target_post_id: string | null;
}

interface BlogPostTargetRow {
  slug: string | null;
}

interface BlogPostRedirectMerchant {
  id: string;
  business_name: string;
  custom_domain?: string;
  logo_url?: string | null;
  slug: string;
}

export interface BlogPostRedirectTarget {
  merchant: BlogPostRedirectMerchant;
  targetSlug: string;
}

function normalizeBlogSlug(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export async function getBlogPostRedirect(
  identifier: string,
  sourceSlug: string
): Promise<BlogPostRedirectTarget | null> {
  // PR4a: local `'use cache'`, not the framework remote handler. Keyed on
  // arbitrary crawler source slugs (unbounded remote keys) behind two indexed
  // reads on a 16-row table; already fail-loud (throws below), so the remote
  // SET buys nothing but the exit-128 write hazard.
  'use cache';

  const normalizedSourceSlug = normalizeBlogSlug(sourceSlug);
  if (!normalizedSourceSlug) {
    return null;
  }

  cacheLife('merchant');
  cacheTag('blog-posts', getBlogCacheTag(identifier, normalizedSourceSlug));

  const merchant = await getMerchantSafe(identifier.toLowerCase());
  if (!merchant) {
    return null;
  }
  cacheTag(getBlogPostsMerchantCacheTag(merchant.id));

  const supabase = createPublicClient({
    clientInfo: 'baci-web-blog-post-redirect',
    timeoutMs: 5000,
  });

  const { data: redirectRow, error: redirectError } = await supabase
    .from('blog_post_redirects')
    .select('target_post_id')
    .eq('merchant_id', merchant.id)
    .eq('source_slug', normalizedSourceSlug)
    .maybeSingle<BlogPostRedirectRow>();

  if (redirectError) {
    throw redirectError;
  }

  const targetPostId = redirectRow?.target_post_id?.trim();
  if (!targetPostId) {
    return null;
  }

  const { data: targetPost, error: targetPostError } = await supabase
    .from('blog_posts')
    .select('slug')
    .eq('merchant_id', merchant.id)
    .eq('id', targetPostId)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .maybeSingle<BlogPostTargetRow>();

  if (targetPostError) {
    throw targetPostError;
  }

  const resolvedTargetSlug = normalizeBlogSlug(targetPost?.slug);
  if (!resolvedTargetSlug) {
    return null;
  }

  return {
    merchant: {
      id: merchant.id,
      business_name: merchant.business_name,
      custom_domain: merchant.custom_domain ?? undefined,
      logo_url: merchant.logo_url,
      slug: merchant.slug,
    },
    targetSlug: resolvedTargetSlug,
  };
}
