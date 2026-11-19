import { cacheLife, cacheTag } from 'next/cache';
import { getBlogCacheTag } from '@/lib/blog-cache-tags';
import { getMerchantSafe } from '@/lib/cached-data';
import { applyPublicBlogSqlFilters } from '@/lib/public-blog-sql-filters';
import { toSafeInternalRedirectPath } from '@/lib/safe-internal-redirect-path';
import { createPublicClient } from '@/lib/supabase/anon';
import { getBlogPostsMerchantCacheTag } from '@/lib/tenant-cache-tags';

interface BlogPostRedirectRow {
  target_post_id: string | null;
}

interface BlogPostTargetRow {
  slug: string | null;
}

const FAIL_OPEN = { hasError: true, present: false, redirectPath: null };
const MISSING = { hasError: false, present: false, redirectPath: null };
const PRESENT = { hasError: false, present: true, redirectPath: null };

function normalizeBlogSlug(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildRedirectBody(targetSlug: string) {
  const redirectPath = toSafeInternalRedirectPath(`/blog/${targetSlug}`);
  return redirectPath
    ? { hasError: false, present: true, redirectPath }
    : FAIL_OPEN;
}

export async function getCachedStorefrontBlogPostStatus(
  identifier: string,
  postSlug: string
) {
  'use cache';

  const lookupKey = identifier.trim().toLowerCase();
  const sourceSlug = normalizeBlogSlug(postSlug);
  if (!lookupKey || !sourceSlug) {
    return FAIL_OPEN;
  }

  cacheLife('blog');
  cacheTag('blog-posts', getBlogCacheTag(lookupKey, sourceSlug));

  const merchant = await getMerchantSafe(lookupKey);
  if (!merchant?.is_published) {
    return FAIL_OPEN;
  }
  cacheTag(getBlogPostsMerchantCacheTag(merchant.id));

  if (!merchant.feature_settings?.blog_enabled) {
    return MISSING;
  }

  const supabase = createPublicClient({
    clientInfo: 'baci-web-internal-blog-post-status',
    timeoutMs: 5000,
  });

  let postQuery = supabase
    .from('blog_posts')
    .select('slug')
    .eq('merchant_id', merchant.id)
    .eq('slug', sourceSlug)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .not('title', 'is', null)
    .not('slug', 'is', null)
    .neq('title', '')
    .neq('slug', '');

  postQuery = applyPublicBlogSqlFilters(postQuery);

  const { data: post, error: postError } =
    await postQuery.maybeSingle<BlogPostTargetRow>();
  if (postError) {
    throw postError;
  }
  if (normalizeBlogSlug(post?.slug)) {
    return PRESENT;
  }

  const { data: redirectRow, error: redirectError } = await supabase
    .from('blog_post_redirects')
    .select('target_post_id')
    .eq('merchant_id', merchant.id)
    .eq('source_slug', sourceSlug)
    .maybeSingle<BlogPostRedirectRow>();
  if (redirectError) {
    throw redirectError;
  }

  const targetPostId = redirectRow?.target_post_id?.trim();
  if (!targetPostId) {
    return MISSING;
  }

  let targetPostQuery = supabase
    .from('blog_posts')
    .select('slug')
    .eq('merchant_id', merchant.id)
    .eq('id', targetPostId)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .not('title', 'is', null)
    .not('slug', 'is', null)
    .neq('title', '')
    .neq('slug', '');

  targetPostQuery = applyPublicBlogSqlFilters(targetPostQuery);

  const { data: targetPost, error: targetPostError } =
    await targetPostQuery.maybeSingle<BlogPostTargetRow>();
  if (targetPostError) {
    throw targetPostError;
  }

  const targetSlug = normalizeBlogSlug(targetPost?.slug);
  if (!targetSlug || targetSlug === sourceSlug) {
    return MISSING;
  }

  return buildRedirectBody(targetSlug);
}
